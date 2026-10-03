/**
 * Small RFC-4180-style streaming decoder shared by private import paths.
 * Callers retain responsibility for schema and row-size validation.
 */
export class StreamingCsvRecordDecoder {
  private readonly emit: (values: readonly string[]) => Promise<void>;
  private readonly maximumFieldCharacters: number;
  private readonly maximumRowCharacters: number;
  private value = "";
  private row: string[] = [];
  private rowCharacters = 0;
  private quoted = false;
  private afterQuote = false;
  private pending: Promise<void> = Promise.resolve();

  constructor(
    emit: (values: readonly string[]) => Promise<void>,
    bounds: Readonly<{
      maximumFieldCharacters: number;
      maximumRowCharacters: number;
    }> = {
      maximumFieldCharacters: Number.MAX_SAFE_INTEGER,
      maximumRowCharacters: Number.MAX_SAFE_INTEGER,
    },
  ) {
    this.emit = emit;
    if (
      !Number.isSafeInteger(bounds.maximumFieldCharacters) ||
      bounds.maximumFieldCharacters < 1 ||
      !Number.isSafeInteger(bounds.maximumRowCharacters) ||
      bounds.maximumRowCharacters < bounds.maximumFieldCharacters
    ) {
      throw new Error("CSV decoder bounds are invalid");
    }
    this.maximumFieldCharacters = bounds.maximumFieldCharacters;
    this.maximumRowCharacters = bounds.maximumRowCharacters;
  }

  push(text: string): void {
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (character === undefined) continue;
      if (this.quoted) {
        if (character === '"') {
          if (text[index + 1] === '"') {
            this.appendCharacter('"');
            index += 1;
          } else {
            this.quoted = false;
            this.afterQuote = true;
          }
        } else {
          this.appendCharacter(character);
        }
        continue;
      }
      if (this.afterQuote) {
        if (character === '"') {
          this.appendCharacter('"');
          this.quoted = true;
          this.afterQuote = false;
          continue;
        }
        if (character === ",") {
          this.finishValue();
          continue;
        }
        if (character === "\n" || character === "\r") {
          this.finishValue();
          this.finishRow();
          if (character === "\r" && text[index + 1] === "\n") index += 1;
          continue;
        }
        throw new Error("CSV contains characters after a closing quote");
      }
      if (character === '"') {
        if (this.value !== "") throw new Error("CSV quote is misplaced");
        this.quoted = true;
      } else if (character === ",") {
        this.finishValue();
      } else if (character === "\n" || character === "\r") {
        this.finishValue();
        this.finishRow();
        if (character === "\r" && text[index + 1] === "\n") index += 1;
      } else {
        this.appendCharacter(character);
      }
    }
  }

  async finish(): Promise<void> {
    if (this.quoted) throw new Error("CSV has an unterminated quoted value");
    if (this.value !== "" || this.row.length > 0 || this.afterQuote) {
      this.finishValue();
      this.finishRow();
    }
    await this.pending;
  }

  async settled(): Promise<void> {
    await this.pending;
  }

  private finishValue(): void {
    this.row.push(this.value);
    this.value = "";
    this.afterQuote = false;
  }

  private finishRow(): void {
    const row = this.row;
    this.row = [];
    this.rowCharacters = 0;
    if (row.length === 1 && row[0] === "") return;
    this.pending = this.pending.then(() => this.emit(row));
  }

  private appendCharacter(character: string): void {
    if (
      this.value.length >= this.maximumFieldCharacters ||
      this.rowCharacters >= this.maximumRowCharacters
    ) {
      throw new Error("CSV row exceeds configured capacity");
    }
    this.value += character;
    this.rowCharacters += 1;
  }
}
