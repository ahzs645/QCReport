import { describe, expect, it } from "vitest";
import { parseNrbf } from "../scripts/lib/raw-parsers/nrbf.mjs";

// Hand-encode a minimal [MS-NRBF] stream (the real .esws parts are client data
// and not committed). Covers the records the .esws parser relies on: the stream
// header, a class with typed members, an inline Int32 primitive, a string member
// (BinaryObjectString), a primitive array, and MessageEnd.

function buildStream() {
  const bytes = [];
  const b = (n) => bytes.push(n & 0xff);
  const i32 = (n) => { const v = n >>> 0; b(v); b(v >> 8); b(v >> 16); b(v >> 24); };
  const f64 = (n) => { const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, n, true); for (let i = 0; i < 8; i++) b(dv.getUint8(i)); };
  const lps = (s) => { const u = new TextEncoder().encode(s); b(u.length); for (const x of u) b(x); }; // len < 128

  // SerializationHeaderRecord
  b(0); i32(1); i32(-1); i32(1); i32(0);

  // SystemClassWithMembersAndTypes (record 4): objectId 1, 3 members
  b(4);
  i32(1); lps("MyClass"); i32(3);
  lps("Num"); lps("Name"); lps("Vals");
  // member binary types: Primitive(0), String(1), PrimitiveArray(7)
  b(0); b(1); b(7);
  // additional infos: Primitive -> Int32(8); String -> none; PrimitiveArray -> Double(6)
  b(8); b(6);
  // member values
  i32(42);                       // Num (inline Int32)
  b(6); i32(2); lps("hi");       // Name -> BinaryObjectString objectId 2
  b(15); i32(3); i32(2); b(6); f64(1.5); f64(2.5); // Vals -> ArraySinglePrimitive id3, len2, Double, [1.5,2.5]

  b(11); // MessageEnd
  return new Uint8Array(bytes);
}

describe("parseNrbf", () => {
  it("decodes header, typed class members, string ref, and primitive array", () => {
    const { root, get } = parseNrbf(buildStream());
    expect(root).toBe(1);
    const obj = get(1);
    expect(obj.__class).toBe("MyClass");
    expect(obj.members.Num).toBe(42);
    expect(obj.members.Name).toBe("hi");
    expect(obj.members.Vals).toEqual([1.5, 2.5]);
  });
});
