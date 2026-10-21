import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipEntryInput {
  name: string;
  content: string | Buffer;

  /** `deflate` (padrão) comprime; `store` guarda sem comprimir. */
  method?: 'deflate' | 'store';

  /**
   * Tamanho descompactado declarado no diretório central, quando é para mentir
   * sobre ele (teste de limite de tamanho). O padrão é o tamanho real.
   */
  declaredUncompressedSize?: number;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const UTF8_NAMES_FLAG = 0x0800;
const DOS_DATE = ((2026 - 1980) << 9) | (10 << 5) | 20;

/**
 * Monta um `.zip` em memória para os testes, sem depender de um utilitário do
 * sistema: o que importa é ter um arquivo que o leitor de produção abra.
 */
export function buildZip(entries: readonly ZipEntryInput[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content, 'utf8');
    const method = entry.method === 'store' ? 0 : 8;
    const data = method === 0 ? raw : deflateRawSync(raw);
    const checksum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_NAMES_FLAG, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(CENTRAL_HEADER, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(UTF8_NAMES_FLAG, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(checksum, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(entry.declaredUncompressedSize ?? raw.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);

    parts.push(local, name, data);
    central.push(header, name);
    offset += local.length + name.length + data.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...parts, directory, end]);
}
