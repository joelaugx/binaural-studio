/**
 * fixWebmDuration.ts
 *
 * Corrige o campo Duration no header EBML de arquivos WebM gerados pelo
 * MediaRecorder do Chrome. Esses arquivos não incluem Duration, fazendo
 * editores como CapCut 8.6+ rejeitarem a faixa de áudio.
 *
 * ESTRATÉGIA:
 * - `injectDurationPlaceholder(chunk)`: Chamada no PRIMEIRO chunk de dados.
 *   Modifica o SegmentInfo para incluir um Duration=0 (placeholder de 11 bytes).
 *   Como o primeiro chunk contém o header EBML completo, isso funciona.
 *
 * - `patchDurationValue(fileHandle, durationMs)`: Chamada APÓS a gravação.
 *   Localiza o placeholder Duration=0 e sobrescreve com o valor real.
 *   Apenas 8 bytes são modificados in-place — sem realocação.
 */

// Duration EBML element: ID(2) + VINT size(1) + float64(8) = 11 bytes
const DURATION_ID = new Uint8Array([0x44, 0x89]);
const DURATION_VINT_SIZE = 0x88; // = 8 bytes de payload
const PLACEHOLDER_DURATION = 11; // total bytes do elemento

/**
 * Injeta um campo Duration=0 (placeholder) no SegmentInfo do primeiro chunk
 * do MediaRecorder. Deve ser chamada ANTES de escrever o chunk no disco.
 *
 * @param firstChunk - O primeiro Blob de dados do MediaRecorder
 * @returns Blob modificado com o Duration placeholder inserido
 */
export async function injectDurationPlaceholder(firstChunk: Blob): Promise<Blob> {
  const data = new Uint8Array(await firstChunk.arrayBuffer());

  // Encontrar SegmentInfo (ID: 0x15 0x49 0xA9 0x66)
  const segInfoOffset = findPattern(data, [0x15, 0x49, 0xa9, 0x66]);
  if (segInfoOffset === -1) {
    console.warn("[fixWebmDuration] SegmentInfo não encontrado no primeiro chunk.");
    return firstChunk;
  }

  // Decodificar VINT do tamanho do SegmentInfo
  const vintStart = segInfoOffset + 4;
  const { value: origSize, length: vintLen } = decodeVint(data, vintStart);
  const payloadStart = vintStart + vintLen;
  const payloadEnd = payloadStart + origSize;

  // Criar o Duration element (placeholder com valor 0)
  const durationElement = new Uint8Array(PLACEHOLDER_DURATION);
  durationElement[0] = DURATION_ID[0];
  durationElement[1] = DURATION_ID[1];
  durationElement[2] = DURATION_VINT_SIZE;
  // bytes 3-10 ficam 0 (float64 = 0.0)

  // Novo tamanho do SegmentInfo
  const newSize = origSize + PLACEHOLDER_DURATION;
  const newVint = encodeVint(newSize);

  // Montar o novo chunk:
  // [antes do SegmentInfo] + [SegInfo ID] + [novo VINT] + [payload original] + [Duration] + [depois do SegmentInfo]
  const before = data.slice(0, segInfoOffset);
  const segInfoId = data.slice(segInfoOffset, segInfoOffset + 4);
  const originalPayload = data.slice(payloadStart, payloadEnd);
  const after = data.slice(payloadEnd);

  const newData = new Uint8Array(
    before.length + 4 + newVint.length + originalPayload.length + PLACEHOLDER_DURATION + after.length
  );

  let offset = 0;
  newData.set(before, offset); offset += before.length;
  newData.set(segInfoId, offset); offset += 4;
  newData.set(newVint, offset); offset += newVint.length;
  newData.set(originalPayload, offset); offset += originalPayload.length;
  newData.set(durationElement, offset); offset += PLACEHOLDER_DURATION;
  newData.set(after, offset);

  return new Blob([newData], { type: firstChunk.type });
}

/**
 * Sobrescreve o placeholder Duration=0 com a duração real.
 * Apenas modifica 8 bytes in-place — seguro para arquivos de qualquer tamanho.
 *
 * @param fileHandle - FileSystemFileHandle do arquivo WebM
 * @param durationMs - Duração total em milissegundos
 */
export async function patchDurationValue(
  fileHandle: FileSystemFileHandle,
  durationMs: number
): Promise<void> {
  try {
    const file = await fileHandle.getFile();

    // Ler apenas os primeiros 512 bytes (o header fica nessa região)
    const headerSize = Math.min(512, file.size);
    const headerBuf = new Uint8Array(await file.slice(0, headerSize).arrayBuffer());

    // Procurar o campo Duration (0x44 0x89 0x88 seguido de 8 bytes)
    const durationOffset = findPattern(headerBuf, [0x44, 0x89, 0x88]);
    if (durationOffset === -1) {
      console.warn("[fixWebmDuration] Placeholder Duration não encontrado no header.");
      return;
    }

    // O payload float64 começa 3 bytes após o início do elemento
    const valueOffset = durationOffset + 3;

    // Escrever o float64 in-place (apenas 8 bytes)
    const valueBuf = new ArrayBuffer(8);
    new DataView(valueBuf).setFloat64(0, durationMs, false); // big-endian

    const writable = await fileHandle.createWritable({ keepExistingData: true });
    await writable.seek(valueOffset);
    await writable.write(new Uint8Array(valueBuf));
    await writable.close();

    console.log(
      `[fixWebmDuration] ✅ Duration corrigida: ${(durationMs / 1000).toFixed(1)}s ` +
      `(offset=${valueOffset})`
    );
  } catch (err) {
    console.error("[fixWebmDuration] Erro ao corrigir duração:", err);
  }
}

// ---- Helpers ----

function findPattern(data: Uint8Array, pattern: number[]): number {
  for (let i = 0; i <= data.length - pattern.length; i++) {
    let found = true;
    for (let j = 0; j < pattern.length; j++) {
      if (data[i + j] !== pattern[j]) {
        found = false;
        break;
      }
    }
    if (found) return i;
  }
  return -1;
}

function decodeVint(data: Uint8Array, offset: number): { value: number; length: number } {
  const first = data[offset];
  let length = 0;
  let mask = 0x80;

  for (let i = 0; i < 8; i++) {
    if (first & mask) {
      length = i + 1;
      break;
    }
    mask >>= 1;
  }

  if (length === 0) return { value: 0, length: 1 };

  let value = first & (mask - 1);
  for (let i = 1; i < length; i++) {
    value = (value << 8) | data[offset + i];
  }

  return { value, length };
}

function encodeVint(value: number): Uint8Array {
  if (value < 0x7f) {
    return new Uint8Array([0x80 | value]);
  } else if (value < 0x3fff) {
    return new Uint8Array([0x40 | (value >> 8), value & 0xff]);
  } else if (value < 0x1fffff) {
    return new Uint8Array([0x20 | (value >> 16), (value >> 8) & 0xff, value & 0xff]);
  } else {
    return new Uint8Array([
      0x10 | (value >> 24),
      (value >> 16) & 0xff,
      (value >> 8) & 0xff,
      value & 0xff,
    ]);
  }
}
