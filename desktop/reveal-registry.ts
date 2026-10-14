/**
 * Fertige Dateien, die sich zeigen lassen.
 *
 * `NativeStore.finish()` räumt die Ausgabe aus seinem Register – danach weiß
 * niemand mehr, wo die Datei liegt. Genau dann will der Nutzer sie aber sehen.
 * Also merkt sich der Hauptprozess beim Abschluss den Pfad unter der Kennung,
 * die der Renderer ohnehin kennt.
 *
 * Der Renderer bekommt dabei nie einen Pfad zu sehen: Er schickt eine Kennung
 * und eine Datei im Dateimanager erscheint. Damit ist „zeigen" die einzige
 * Fähigkeit, die an diesen Kennungen hängt – kein Dateizugriff, kein Shell-Befehl.
 *
 * Eigene Datei, eigene Prüfung: Die Verdrängung (eine lange Sitzung darf den
 * Speicher nicht füllen) ist Logik, keine Nebensache.
 */
export class RevealRegistry {
  private files = new Map<string, string>();

  constructor(private limit = 2000) {}

  /** Merkt sich den Pfad einer fertig geschriebenen Datei. */
  remember(outputId: string, file: string): void {
    /*
     * Erst löschen, dann setzen: Eine bereits bekannte Kennung rutscht damit ans
     * Ende der Reihenfolge und wird nicht als älteste verdrängt, während sie
     * noch gebraucht wird.
     */
    this.files.delete(outputId);
    this.files.set(outputId, file);
    while (this.files.size > this.limit) {
      const oldest = this.files.keys().next().value;
      if (oldest === undefined) break;
      this.files.delete(oldest);
    }
  }

  /** Der Pfad zu einer Kennung – oder nichts, wenn sie nie hier war. */
  find(outputId: string): string | undefined {
    return this.files.get(outputId);
  }

  get size(): number {
    return this.files.size;
  }
}
