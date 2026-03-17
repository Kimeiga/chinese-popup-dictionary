/**
 * Extract Chinese text at a given point in the document.
 *
 * Uses document.caretRangeFromPoint (Chrome) or document.caretPositionFromPoint
 * to find the exact text node and offset under the cursor.
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
  if (!range) return null;

  const node = range.startContainer;
  const offset = range.startOffset;

  // Must be a text node
  if (node.nodeType !== Node.TEXT_NODE) return null;

  const textNode = node as Text;
  const fullText = textNode.textContent || '';

  // Check if the character under cursor is CJK
  if (offset >= fullText.length) return null;
  const charAtCursor = fullText[offset];
  if (!CJK_REGEX.test(charAtCursor)) return null;

  // Extract text from offset, up to maxLen characters
  // Also look into subsequent text nodes for continuous CJK text
  let text = fullText.substring(offset, offset + maxLen);

  // If we need more characters, walk to sibling text nodes
  if (text.length < maxLen) {
    const extra = collectFollowingText(textNode, maxLen - text.length);
    text += extra;
  }

  return { text, range, node: textNode, offset };
}

/**
 * Walk the DOM from a text node to collect following text content.
 */
function collectFollowingText(node: Text, maxLen: number): string {
  let result = '';
  let current: Node | null = node;

  while (result.length < maxLen) {
    // Try next sibling
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
  // First try children
  if (node.firstChild) {
    let child: Node | null = node.firstChild;
    while (child) {
      if (child.nodeType === Node.TEXT_NODE) return child;
      const found = findFirstTextNode(child);
      if (found) return found;
      child = child.nextSibling;
    }
  }

  // Then siblings and ancestors' siblings
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
