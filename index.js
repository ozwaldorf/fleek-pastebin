import * as Blake3 from 'ipfs://bafkreidlknwg33twrtlm5tagbpdyhkovouzkpkp2sfpp4n2i6o4jiclq5i';
import { Buffer } from 'node:buffer';

// Hex < - > Bytes
const htob = s => new Uint8Array([...s.matchAll(/../g)].map(m => parseInt(m[0], 16)));
const btoh = b => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function main({ path, method, body, headers }) {
  // Parse hostname url from the forwarded host, or fallback to a direct network link
  const host = headers["x-forwarded-host"]
    || `https://fleek-test.network/services/1/${location.protocol.replace(':', '')}/${location.host}`;

  switch (method) {
    case "GET": return await handleGet(host, path);
    case "PUT": return await handlePut(host, body);
  }
}

function handleGet(host, path) {
  if (path == "" || path == "/") {
    return handleUsage(host)
  } else {
    return handleContent(path)
  }
}

function handleUsage(host) {
  return `\
PASTEBIN(1)             User Commands             PASTEBIN(1)

 USAGE
   View help    :  curl ${host} -L
   Upload file  :  curl ${host} -LT file

 DESCRIPTION
   Command line pastebin on fleek network.

   Pastes are identified by their hex-encoded blake3 hashes.
   Currently backed by 0dd.sh for temporary storage to cache
   data on the network.

 SEE ALSO
   * Fleek Network  :  https://fleek.network
   * 0dd.sh         :  https://0dd.sh
`;
}


async function handleContent(path) {
  console.log(path);
  // Parse hash from request path
  const hash = path.split('/')[1];
  console.log(hash);
  if (!hash || hash.length !== 64)
    return "not found";
  const bytes = htob(hash);

  // Sync paste from cache
  await Fleek.fetchBlake3(bytes);

  // Load handle to content and read all blocks
  const handle = await Fleek.loadContent(new Uint8Array(bytes));
  let data = [];
  for (let i = 0; i < handle.length; i++) {
    data.push(await handle.readBlock(i));
  }

  // Concat data together and stream
  const flatArray = data.reduce((acc, curr) => {
    acc.push(...curr);
    return acc;
  }, []);
  return new Uint8Array(flatArray);
}

async function handlePut(host, body) {
  // normalize body into byte array
  let bytes;
  if (ArrayBuffer.isView(body)) {
    bytes = body;
  } else {
    const encoder = new TextEncoder();
    switch (typeof body) {
      case 'undefined':
        return 'empty upload body';
      case 'string':
        bytes = encoder.encode(body);
        break;
      default:
        const str = JSON.stringify(body);
        bytes = encoder.encode(str);
        break;
    }
  }

  // Hash content
  const digest = Blake3.hash(new Uint8Array(bytes));

  // PUT request to 0dd.sh for temp storage and construct a sri hashed origin url
  const res = await fetch("https://0dd.sh", { method: "PUT", body: bytes });
  const text = await res.text();
  if (res.status !== 200) {
    return text;
  }
  const originUrl = `${text.trim()}#integrity=blake3-${Buffer.from(digest).toString('base64')}`;

  // Introduce the computed origin url to the network, caching the blake3 data
  await Fleek.fetchFromOrigin(originUrl);

  return `${host}/${btoh(digest)}`
}
