/**
 * Extract Chinese text at a given point in the document.
 *
 * Uses document.caretRangeFromPoint (Chrome) to find the exact text node
 * and offset under the cursor.
 *
 * Workarounds (inspired by 10ten Japanese Reader):
 * - user-select: none — temporarily forces `user-select: text` on the element
 *   and ancestors so caretRangeFromPoint can find the text.
 * - Invisible overlays — temporarily sets `pointer-events: none` on overlay
 *   elements that sit on top of text, then retries.
 * - Caret offset correction — caretRangeFromPoint returns a caret (insertion
 *   point), not the character. We correct for midpoint snapping.
 * - Hysteresis — if cursor moved <4px, keep the previous result.
 */

// Regex to detect if a character is CJK (Chinese/Japanese/Korean)
const CJK_REGEX =
  /[\u2E80-\u2FFF\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FA1F}]/u;

export interface TextAtPoint {
  /** The extracted text string starting from the hovered character */
  text: string;
  /** The range covering the matched text */
  range: Range | null;
  /** The text node containing the text */
  node: Text | null;
  /** The offset within the text node */
  offset: number;
}

// Cache of previous result
let cachedResult: TextAtPoint | null = null;
let cachedPoint: { x: number; y: number } | null = null;

/** Clear all cached state (call when popup is dismissed). */
export function clearTextAtPointCache(): void {
  cachedResult = null;
  cachedPoint = null;
}

function distanceSq(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return dx * dx + dy * dy;
}

// ---- user-select workaround ----

/**
 * Temporarily force user-select: text on an element and all ancestors that
 * have user-select set to something other than auto/text.
 * Returns a restore function that undoes the changes.
 */
function forceUserSelectText(element: Element): () => void {
  const modified: { el: HTMLElement; originalStyle: string | null }[] = [];
  let current: Element | null = element;

  while (current && current !== document.documentElement) {
    if (current instanceof HTMLElement) {
      const computed = getComputedStyle(current);
      const us = computed.userSelect || (computed as any).webkitUserSelect;
      if (us && us !== 'auto' && us !== 'text') {
        modified.push({
          el: current,
          originalStyle: current.getAttribute('style'),
        });
        current.style.setProperty('user-select', 'text', 'important');
        current.style.setProperty('-webkit-user-select', 'text', 'important');
      }
    }
    current = current.parentElement;
  }

  return () => {
    for (const { el, originalStyle } of modified) {
      if (originalStyle === null) {
        el.removeAttribute('style');
      } else {
        el.setAttribute('style', originalStyle);
      }
    }
  };
}

// ---- Invisible overlay workaround ----

/**
 * Check if an element is visually empty / transparent and likely an overlay
 * that blocks caretRangeFromPoint from reaching the text underneath.
 */
function isInvisibleOverlay(el: Element): boolean {
  // Skip text-bearing elements
  if (el.childNodes.length > 0) {
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
        return false;
      }
    }
  }

  const style = getComputedStyle(el);

  // Transparent background + no visible content
  const bg = style.backgroundColor;
  const isTransparentBg =
    !bg ||
    bg === 'transparent' ||
    bg === 'rgba(0, 0, 0, 0)';

  const hasNoBorder = !style.borderImageSource && (
    !style.borderWidth ||
    style.borderWidth === '0px' ||
    style.borderStyle === 'none'
  );

  const hasNoBackground = isTransparentBg &&
    (!style.backgroundImage || style.backgroundImage === 'none');

  return hasNoBackground && hasNoBorder;
}

/**
 * Temporarily set pointer-events: none on invisible overlay elements
 * at the given point, then retry caretRangeFromPoint.
 * Returns the range and a restore function.
 */
function caretRangeThroughOverlays(
  x: number,
  y: number
): { range: Range | null; restore: () => void } {
  const elements = document.elementsFromPoint(x, y);
  const modified: { el: HTMLElement; originalStyle: string | null }[] = [];

  for (const el of elements) {
    if (!(el instanceof HTMLElement)) continue;

    // Stop once we find an element with actual text content
    if (el.childNodes.length > 0) {
      let hasText = false;
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
          hasText = true;
          break;
        }
      }
      if (hasText) break;
    }

    if (isInvisibleOverlay(el)) {
      modified.push({
        el,
        originalStyle: el.getAttribute('style'),
      });
      el.style.setProperty('pointer-events', 'none', 'important');
    }
  }

  const range = modified.length > 0 ? document.caretRangeFromPoint(x, y) : null;

  const restore = () => {
    for (const { el, originalStyle } of modified) {
      if (originalStyle === null) {
        el.removeAttribute('style');
      } else {
        el.setAttribute('style', originalStyle);
      }
    }
  };

  return { range, restore };
}

// ---- Caret offset correction ----

/**
 * caretRangeFromPoint returns a caret position (between characters), not the
 * character under the cursor. When the cursor is past the midpoint of a glyph,
 * it snaps to the next caret, giving offset N+1 instead of N. This function
 * checks the bounding rect of the character at `offset` and, if the cursor
 * falls to its left, falls back to `offset - 1`.
 */
function adjustOffsetForPoint(
  textNode: Text,
  offset: number,
  fullText: string,
  x: number
): number {
  if (offset >= fullText.length) {
    // Caret is at the end — the actual character must be the one before
    return offset - 1;
  }

  // Get the bbox of the character at `offset`
  const charRange = document.createRange();
  charRange.setStart(textNode, offset);
  charRange.setEnd(textNode, offset + 1);
  const rect = charRange.getBoundingClientRect();

  // If cursor is within this character's horizontal bounds, offset is correct
  if (x >= rect.left && x <= rect.right) {
    return offset;
  }

  // Cursor is to the left — try previous character
  if (x < rect.left && offset > 0) {
    return offset - 1;
  }

  return offset;
}

// ---- Main lookup ----

/**
 * Try to get a Range at (x, y) with all workarounds applied.
 */
function getCaretRangeWithWorkarounds(x: number, y: number): Range | null {
  // 1. Standard attempt
  let range = document.caretRangeFromPoint(x, y);

  // 2. If no result or result is not a text node, try user-select fix
  if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) {
    const elementAtPoint = document.elementFromPoint(x, y);
    if (elementAtPoint) {
      const restore = forceUserSelectText(elementAtPoint);
      range = document.caretRangeFromPoint(x, y);
      restore();

      if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
        return range;
      }
    }
  }

  // 3. If still no text node, try looking through invisible overlays
  if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) {
    const { range: overlayRange, restore } = caretRangeThroughOverlays(x, y);
    restore();
    if (overlayRange && overlayRange.startContainer.nodeType === Node.TEXT_NODE) {
      return overlayRange;
    }

    // 4. Combine both: overlays + user-select
    if (!overlayRange || overlayRange.startContainer.nodeType !== Node.TEXT_NODE) {
      const elements = document.elementsFromPoint(x, y);
      const overlayMods: { el: HTMLElement; originalStyle: string | null }[] = [];

      // Disable overlays
      for (const el of elements) {
        if (el instanceof HTMLElement && isInvisibleOverlay(el)) {
          overlayMods.push({ el, originalStyle: el.getAttribute('style') });
          el.style.setProperty('pointer-events', 'none', 'important');
        }
      }

      if (overlayMods.length > 0) {
        const el2 = document.elementFromPoint(x, y);
        if (el2) {
          const restoreUs = forceUserSelectText(el2);
          range = document.caretRangeFromPoint(x, y);
          restoreUs();
        }
      }

      // Restore overlays
      for (const { el, originalStyle } of overlayMods) {
        if (originalStyle === null) {
          el.removeAttribute('style');
        } else {
          el.setAttribute('style', originalStyle);
        }
      }

      if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
        return range;
      }
    }
  }

  return range;
}

/**
 * Get text content at a given screen coordinate.
 * Returns up to `maxLen` characters starting from the character under the cursor.
 */
export function getTextAtPoint(
  x: number,
  y: number,
  maxLen: number = 20
): TextAtPoint | null {
  const range = getCaretRangeWithWorkarounds(x, y);
  if (!range) {
    if (cachedResult && cachedPoint && distanceSq(cachedPoint.x, cachedPoint.y, x, y) < 16) {
      return cachedResult;
    }
    return null;
  }

  const node = range.startContainer;
  let offset = range.startOffset;

  // Must be a text node
  if (node.nodeType !== Node.TEXT_NODE) {
    if (cachedResult && cachedPoint && distanceSq(cachedPoint.x, cachedPoint.y, x, y) < 16) {
      return cachedResult;
    }
    return null;
  }

  const textNode = node as Text;
  const fullText = textNode.textContent || '';

  // Correct for caret midpoint snapping
  offset = adjustOffsetForPoint(textNode, offset, fullText, x);

  // Check if the character under cursor is CJK
  if (offset >= fullText.length || offset < 0) return null;
  const charAtCursor = fullText[offset];
  if (!CJK_REGEX.test(charAtCursor)) {
    if (cachedResult && cachedPoint && distanceSq(cachedPoint.x, cachedPoint.y, x, y) < 16) {
      return cachedResult;
    }
    cachedResult = null;
    cachedPoint = null;
    return null;
  }

  // Check if we're on the same text node + offset as before
  if (cachedResult?.node === textNode && cachedResult.offset === offset) {
    cachedPoint = { x, y };
    return cachedResult;
  }

  // Extract text from offset, up to maxLen characters
  let text = fullText.substring(offset, offset + maxLen);

  // If we need more characters, walk to sibling text nodes
  if (text.length < maxLen) {
    const extra = collectFollowingText(textNode, maxLen - text.length);
    text += extra;
  }

  const result: TextAtPoint = { text, range, node: textNode, offset };
  cachedResult = result;
  cachedPoint = { x, y };

  return result;
}

/**
 * Walk the DOM from a text node to collect following text content.
 */
function collectFollowingText(node: Text, maxLen: number): string {
  let result = '';
  let current: Node | null = node;

  while (result.length < maxLen) {
    current = nextTextNode(current);
    if (!current) break;

    const text = (current as Text).textContent || '';
    for (const char of text) {
      if (!CJK_REGEX.test(char)) return result;
      result += char;
      if (result.length >= maxLen) return result;
    }
  }

  return result;
}

/**
 * Find the next text node in document order.
 */
function nextTextNode(node: Node): Node | null {
  if (node.firstChild) {
    let child: Node | null = node.firstChild;
    while (child) {
      if (child.nodeType === Node.TEXT_NODE) return child;
      const found = findFirstTextNode(child);
      if (found) return found;
      child = child.nextSibling;
    }
  }

  let current: Node | null = node;
  while (current) {
    if (current.nextSibling) {
      const sibling: Node = current.nextSibling;
      if (sibling.nodeType === Node.TEXT_NODE) return sibling;
      const found = findFirstTextNode(sibling);
      if (found) return found;
      current = sibling;
    } else {
      current = current.parentNode;
    }
  }

  return null;
}

function findFirstTextNode(node: Node): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return node;
  let child: Node | null = node.firstChild;
  while (child) {
    const found = findFirstTextNode(child);
    if (found) return found;
    child = child.nextSibling;
  }
  return null;
}
