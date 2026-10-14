// -----------------------------------------------------------------------------
// A minimal XML reader for the SIRI answers (SOAP or plain XML), into the shape
// a SIRI Lite server gives in JSON, so one reader (src/siri.js) serves both:
//
//   <MonitoredCall><ExpectedDepartureTime>…</ExpectedDepartureTime></MonitoredCall>
//   → { MonitoredCall: { ExpectedDepartureTime: '…' } }
//
// - Names lose their namespace prefix ("siri:LineRef" → "LineRef").
// - An element repeated under the same parent becomes an array.
// - An element with text only is that text; with an xml:lang attribute it is
//   `{ value, lang }` (the SIRI Lite JSON form of a translated text).
// - Other attributes, comments, processing instructions and the doctype are
//   dropped. CDATA is text.
//
// No dependency, no DTD, no external entity: the input comes from a server.
// -----------------------------------------------------------------------------

export class XmlError extends Error {}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decodes the five XML entities and the character references. */
export function decodeEntities(text) {
  if (!text.includes('&')) {
    return text;
  }
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const value =
        code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1));
      return Number.isFinite(value) && value > 0 && value < 0x110000
        ? String.fromCodePoint(value)
        : '';
    }
    return NAMED[code.toLowerCase()] ?? match;
  });
}

const localName = (name) => name.slice(name.indexOf(':') + 1);

function langOf(attributes) {
  const match = /(?:^|\s)xml:lang\s*=\s*("([^"]*)"|'([^']*)')/.exec(attributes);
  return match ? (match[2] ?? match[3]) : null;
}

/** The value of a closed element: its text, `{ value, lang }`, or its children. */
function finish(node) {
  const text = node.text.trim();
  if (node.children === null) {
    return node.lang ? { value: text, lang: node.lang } : text;
  }
  if (text && !('value' in node.children)) {
    node.children.value = text;
  }
  return node.children;
}

function attach(parent, name, value) {
  parent.children ??= {};
  const children = parent.children;
  if (!(name in children)) {
    children[name] = value;
  } else if (Array.isArray(children[name])) {
    children[name].push(value);
  } else {
    children[name] = [children[name], value];
  }
}

/**
 * @param {string} xml
 * @returns {object} `{ [rootName]: value }`
 */
export function parseXml(xml) {
  const source = String(xml);
  const root = { name: '#root', children: null, text: '', lang: null };
  const stack = [root];
  let pos = 0;
  const top = () => stack[stack.length - 1];
  while (pos < source.length) {
    const lt = source.indexOf('<', pos);
    if (lt < 0) {
      top().text += decodeEntities(source.slice(pos));
      break;
    }
    if (lt > pos) {
      top().text += decodeEntities(source.slice(pos, lt));
    }
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      if (end < 0) {
        throw new XmlError('unterminated comment');
      }
      pos = end + 3;
    } else if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt + 9);
      if (end < 0) {
        throw new XmlError('unterminated CDATA');
      }
      top().text += source.slice(lt + 9, end);
      pos = end + 3;
    } else if (source.startsWith('<?', lt)) {
      const end = source.indexOf('?>', lt + 2);
      if (end < 0) {
        throw new XmlError('unterminated declaration');
      }
      pos = end + 2;
    } else if (source.startsWith('<!', lt)) {
      // DOCTYPE: skipped, its entities never expanded.
      const end = source.indexOf('>', lt + 2);
      if (end < 0) {
        throw new XmlError('unterminated doctype');
      }
      pos = end + 1;
    } else {
      // A tag; attribute values may hold ">".
      const match = /^<(\/?)([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/.exec(
        source.slice(lt, lt + 4096),
      );
      if (!match) {
        throw new XmlError(`malformed tag at ${lt}`);
      }
      const [whole, closing, rawName, attributes, selfClosing] = match;
      const name = localName(rawName);
      pos = lt + whole.length;
      if (closing) {
        const node = stack.pop();
        if (stack.length === 0 || node.name !== name) {
          throw new XmlError(`unexpected </${name}>`);
        }
        attach(top(), name, finish(node));
      } else if (selfClosing) {
        const lang = langOf(attributes);
        attach(top(), name, lang ? { value: '', lang } : '');
      } else {
        stack.push({ name, children: null, text: '', lang: langOf(attributes) });
      }
    }
  }
  if (stack.length !== 1) {
    throw new XmlError(`unclosed <${top().name}>`);
  }
  if (!root.children) {
    throw new XmlError('no element');
  }
  return root.children;
}
