// Minimal [MS-NRBF] (.NET BinaryFormatter) reader — enough to walk Agilent ICP
// Expert .esws parts into a navigable object graph. Browser-portable: takes a
// Uint8Array, uses DataView, no Node APIs.
//
// Spec: [MS-NRBF] "Remoting: Binary Format Data Structure".

const RT = {
  SerializedStreamHeader: 0,
  ClassWithId: 1,
  SystemClassWithMembers: 2,
  ClassWithMembers: 3,
  SystemClassWithMembersAndTypes: 4,
  ClassWithMembersAndTypes: 5,
  BinaryObjectString: 6,
  BinaryArray: 7,
  MemberPrimitiveTyped: 8,
  MemberReference: 9,
  ObjectNull: 10,
  MessageEnd: 11,
  BinaryLibrary: 12,
  ObjectNullMultiple256: 13,
  ObjectNullMultiple: 14,
  ArraySinglePrimitive: 15,
  ArraySingleObject: 16,
  ArraySingleString: 17,
};

// PrimitiveTypeEnumeration
const PT = {
  Boolean: 1, Byte: 2, Char: 3, Decimal: 5, Double: 6, Int16: 7, Int32: 8,
  Int64: 9, SByte: 10, Single: 11, TimeSpan: 12, DateTime: 13, UInt16: 14,
  UInt32: 15, UInt64: 16, Null: 17, String: 18,
};

class Reader {
  constructor(u8) {
    this.u8 = u8;
    this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    this.pos = 0;
  }
  byte() { return this.u8[this.pos++]; }
  bool() { return this.u8[this.pos++] !== 0; }
  int8() { const v = this.dv.getInt8(this.pos); this.pos += 1; return v; }
  int16() { const v = this.dv.getInt16(this.pos, true); this.pos += 2; return v; }
  uint16() { const v = this.dv.getUint16(this.pos, true); this.pos += 2; return v; }
  int32() { const v = this.dv.getInt32(this.pos, true); this.pos += 4; return v; }
  uint32() { const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }
  int64() { const v = this.dv.getBigInt64(this.pos, true); this.pos += 8; return v; }
  uint64() { const v = this.dv.getBigUint64(this.pos, true); this.pos += 8; return v; }
  double() { const v = this.dv.getFloat64(this.pos, true); this.pos += 8; return v; }
  single() { const v = this.dv.getFloat32(this.pos, true); this.pos += 4; return v; }
  // 7-bit-encoded length prefix
  len7() {
    let n = 0, shift = 0, b;
    do { b = this.u8[this.pos++]; n |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    return n >>> 0;
  }
  str() {
    const n = this.len7();
    const bytes = this.u8.subarray(this.pos, this.pos + n);
    this.pos += n;
    return new TextDecoder("utf-8").decode(bytes);
  }
  dateTime() {
    // 64-bit: low 62 bits ticks, top 2 bits = kind. Return ticks as BigInt.
    const raw = this.uint64();
    const ticks = raw & ((1n << 62n) - 1n);
    return { __dateTimeTicks: ticks.toString() };
  }
  primitive(pt) {
    switch (pt) {
      case PT.Boolean: return this.bool();
      case PT.Byte: return this.byte();
      case PT.SByte: return this.int8();
      case PT.Char: { // single UTF-8 char (1-4 bytes)
        const start = this.pos; let n = 1; const b0 = this.u8[start];
        if (b0 >= 0xf0) n = 4; else if (b0 >= 0xe0) n = 3; else if (b0 >= 0xc0) n = 2;
        const s = new TextDecoder("utf-8").decode(this.u8.subarray(start, start + n));
        this.pos += n; return s;
      }
      case PT.Decimal: return this.str();
      case PT.Double: return this.double();
      case PT.Single: return this.single();
      case PT.Int16: return this.int16();
      case PT.UInt16: return this.uint16();
      case PT.Int32: return this.int32();
      case PT.UInt32: return this.uint32();
      case PT.Int64: return this.int64();
      case PT.UInt64: return this.uint64();
      case PT.TimeSpan: return this.int64();
      case PT.DateTime: return this.dateTime();
      case PT.String: return this.str();
      case PT.Null: return null;
      default: throw new Error(`Unknown primitive type ${pt} at ${this.pos}`);
    }
  }
}

const BT = { Primitive: 0, String: 1, Object: 2, SystemClass: 3, Class: 4, ObjectArray: 5, StringArray: 6, PrimitiveArray: 7 };

export function parseNrbf(u8) {
  const r = new Reader(u8);
  const objects = new Map();   // id -> object/value
  const classMeta = new Map(); // metadataId -> { name, memberNames, binaryTypes, additionalInfos }
  let root = null;

  const register = (id, val) => { if (id != null) objects.set(id, val); return val; };

  function readClassInfo() {
    const objectId = r.int32();
    const name = r.str();
    const memberCount = r.int32();
    const memberNames = [];
    for (let i = 0; i < memberCount; i++) memberNames.push(r.str());
    return { objectId, name, memberCount, memberNames };
  }

  function readMemberTypeInfo(memberCount) {
    const binaryTypes = [];
    for (let i = 0; i < memberCount; i++) binaryTypes.push(r.byte());
    const additionalInfos = [];
    for (let i = 0; i < memberCount; i++) {
      const bt = binaryTypes[i];
      if (bt === BT.Primitive || bt === BT.PrimitiveArray) additionalInfos.push(r.byte());
      else if (bt === BT.SystemClass) additionalInfos.push(r.str());
      else if (bt === BT.Class) additionalInfos.push({ typeName: r.str(), libraryId: r.int32() });
      else additionalInfos.push(null);
    }
    return { binaryTypes, additionalInfos };
  }

  function readMemberValue(bt, addl) {
    switch (bt) {
      case BT.Primitive: return r.primitive(addl);
      case BT.String:
      case BT.Object:
      case BT.SystemClass:
      case BT.Class:
      case BT.ObjectArray:
      case BT.StringArray:
      case BT.PrimitiveArray:
        return readRecord();
      default: throw new Error(`Unknown binary type ${bt}`);
    }
  }

  function readMembers(meta, objectId) {
    const obj = { __class: meta.name, __id: objectId, members: {} };
    register(objectId, obj);
    for (let i = 0; i < meta.memberNames.length; i++) {
      obj.members[meta.memberNames[i]] = readMemberValue(meta.binaryTypes[i], meta.additionalInfos[i]);
    }
    return obj;
  }

  function readArrayValues(length, bt, addl) {
    const out = [];
    let i = 0;
    while (i < length) {
      // Null-run records can appear inside object/string arrays.
      const save = r.pos;
      const rt = r.byte();
      if (rt === RT.ObjectNull) { out.push(null); i += 1; continue; }
      if (rt === RT.ObjectNullMultiple256) { const c = r.byte(); for (let k = 0; k < c; k++) out.push(null); i += c; continue; }
      if (rt === RT.ObjectNullMultiple) { const c = r.int32(); for (let k = 0; k < c; k++) out.push(null); i += c; continue; }
      r.pos = save;
      if (bt === BT.Primitive) out.push(r.primitive(addl));
      else out.push(readRecord());
      i += 1;
    }
    return out;
  }

  function readRecord() {
    const rt = r.byte();
    switch (rt) {
      case RT.SerializedStreamHeader: {
        const rootId = r.int32(); r.int32(); r.int32(); r.int32();
        const v = { __header: true, rootId };
        return v;
      }
      case RT.ClassWithMembersAndTypes: {
        const ci = readClassInfo();
        const mti = readMemberTypeInfo(ci.memberCount);
        const libraryId = r.int32();
        const meta = { name: ci.name, memberNames: ci.memberNames, ...mti, libraryId };
        classMeta.set(ci.objectId, meta);
        return readMembers(meta, ci.objectId);
      }
      case RT.SystemClassWithMembersAndTypes: {
        const ci = readClassInfo();
        const mti = readMemberTypeInfo(ci.memberCount);
        const meta = { name: ci.name, memberNames: ci.memberNames, ...mti };
        classMeta.set(ci.objectId, meta);
        return readMembers(meta, ci.objectId);
      }
      case RT.ClassWithId: {
        const objectId = r.int32();
        const metadataId = r.int32();
        const meta = classMeta.get(metadataId);
        if (!meta) throw new Error(`ClassWithId references unknown metadata ${metadataId}`);
        return readMembers(meta, objectId);
      }
      case RT.BinaryObjectString: {
        const objectId = r.int32();
        const s = r.str();
        return register(objectId, s);
      }
      case RT.MemberReference: {
        const idRef = r.int32();
        return { __ref: idRef };
      }
      case RT.ObjectNull: return null;
      case RT.ObjectNullMultiple256: { r.byte(); return null; }
      case RT.ObjectNullMultiple: { r.int32(); return null; }
      case RT.MemberPrimitiveTyped: {
        const pt = r.byte();
        return r.primitive(pt);
      }
      case RT.BinaryLibrary: {
        r.int32(); r.str();
        return readRecord(); // libraries are pass-through; read what follows
      }
      case RT.ArraySinglePrimitive: {
        const objectId = r.int32();
        const length = r.int32();
        const pt = r.byte();
        const arr = []; register(objectId, arr);
        for (let i = 0; i < length; i++) arr.push(r.primitive(pt));
        return arr;
      }
      case RT.ArraySingleObject: {
        const objectId = r.int32();
        const length = r.int32();
        const arr = []; register(objectId, arr);
        const vals = readArrayValues(length, BT.Object, null);
        for (const v of vals) arr.push(v);
        return arr;
      }
      case RT.ArraySingleString: {
        const objectId = r.int32();
        const length = r.int32();
        const arr = []; register(objectId, arr);
        const vals = readArrayValues(length, BT.String, null);
        for (const v of vals) arr.push(v);
        return arr;
      }
      case RT.BinaryArray: {
        const objectId = r.int32();
        const arrayType = r.byte();      // BinaryArrayTypeEnumeration
        const rank = r.int32();
        const lengths = []; for (let i = 0; i < rank; i++) lengths.push(r.int32());
        // offsets for Offset/Jagged variants
        if (arrayType === 3 || arrayType === 4 || arrayType === 5) for (let i = 0; i < rank; i++) r.int32();
        const bt = r.byte();
        let addl = null;
        if (bt === BT.Primitive || bt === BT.PrimitiveArray) addl = r.byte();
        else if (bt === BT.SystemClass) addl = r.str();
        else if (bt === BT.Class) addl = { typeName: r.str(), libraryId: r.int32() };
        const total = lengths.reduce((a, b) => a * b, 1);
        const arr = []; register(objectId, arr);
        const vals = readArrayValues(total, bt, addl);
        for (const v of vals) arr.push(v);
        return arr;
      }
      case RT.MessageEnd: return { __end: true };
      default:
        throw new Error(`Unsupported record type ${rt} at byte ${r.pos - 1}`);
    }
  }

  // Stream = header, then records until MessageEnd.
  const header = readRecord();
  root = header.rootId;
  let guard = 0;
  while (r.pos < r.u8.length) {
    if (++guard > 5_000_000) throw new Error("runaway parse");
    const before = r.pos;
    const rec = readRecord();
    if (rec && rec.__end) break;
    if (r.pos === before) break;
  }

  // Resolve {__ref} placeholders against the object table (in place).
  const seen = new Set();
  function resolve(v) {
    if (v == null || typeof v !== "object") return v;
    if (v.__ref != null) return objects.has(v.__ref) ? objects.get(v.__ref) : v;
    if (seen.has(v)) return v;
    seen.add(v);
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = resolve(v[i]); return v; }
    if (v.members) for (const k of Object.keys(v.members)) v.members[k] = resolve(v.members[k]);
    return v;
  }
  for (const v of objects.values()) resolve(v);

  return { root, objects, get: (id) => objects.get(id) };
}
