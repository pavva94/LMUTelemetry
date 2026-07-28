import { describe, expect, it } from "vitest";
import { translateLegacyText } from "./legacyText";

describe("legacy engineering summary translations", () => {
  it("translates finding titles, dynamic evidence, and details", () => {
    expect(translateLegacyText("Race strategy review", "it")).toBe("Revisione strategia gara");
    expect(translateLegacyText("2 pit events; model suggests 3 fuel stops", "it")).toBe("2 eventi pit; il modello suggerisce 3 soste carburante");
    expect(translateLegacyText("Trend degrading; consistency low", "it")).toBe("Trend in calo; costanza bassa");
    expect(translateLegacyText("Brake temperatures are not showing a large corner-to-corner split.", "it")).toBe("Le temperature freni non mostrano grandi differenze tra le ruote.");
  });

  it("translates the generated next-session recommendation", () => {
    const english = "Run the race at controlled pace, targeting 1:30.0-1:31.0. Base fuel plan is 2 stops. Fuel margin for that stop count is positive by 3.20 L. Tyre wear supports extending sets; full tyre changes are optional unless balance or temperatures worsen. No major tyre wear warning is available yet. Lap pace is stable enough for a predictable race plan.";
    const italian = translateLegacyText(english, "it");

    expect(italian).not.toContain("Run the race");
    expect(italian).not.toContain("Fuel margin");
    expect(italian).not.toContain("Tyre wear supports");
    expect(italian).toContain("Gestisci la gara con un passo controllato");
    expect(italian).toContain("Il margine carburante");
  });
});
