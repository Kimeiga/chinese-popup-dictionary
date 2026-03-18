/**
 * Extract Chinese text at a given point in the document.
 *
 * Uses document.caretRangeFromPoint (Chrome) to find the exact text node
 * and offset under the cursor.
 *
 * Since highlighting uses the CSS Custom Highlight API (no DOM mutation),
 * text node references remain stable. Simple node+offset caching is
 * sufficient to avoid redundant work.
 *
 * Hysteresis: if cursor moved less than 4px, keep the previous result
 * to avoid flicker at character boundaries.
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

/**
 * Get text content at a given screen coordinate.
 * Returns up to `maxLen` characters starting from the character under the cursor.
 */
export function getTextAtPoint(
  x: number,
  y: number,
  maxLen: number = 20
): TextAtPoint | null {
  // Use Chrome's caretRangeFromPoint
  const range = document.caretRangeFromPoint(x, y);
  if (!range) {
    // Hysteresis: if moved <4px from last successful result, keep it
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

  // caretRangeFromPoint returns the nearest caret (insertion point between
  // characters), not the character under the cursor. Past the midpoint of a
  // character it snaps to the RIGHT edge, giving offset N+1 instead of N.
  // Fix: check if cursor x is within the bbox of char at `offset`. If not,
  // try `offset - 1`.
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
