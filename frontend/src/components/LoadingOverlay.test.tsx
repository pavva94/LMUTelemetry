import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoadingOverlay } from "./LoadingOverlay";

describe("LoadingOverlay", () => {
  it("renders tracked progress accessibly", () => {
    const html = renderToStaticMarkup(
      <LoadingOverlay show title="Validating telemetry" detail="Processed 2 of 4 files" percentage={50} />,
    );

    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain("Validating telemetry");
    expect(html).toContain("50%");
  });

  it("does not render while hidden", () => {
    expect(renderToStaticMarkup(<LoadingOverlay show={false} />)).toBe("");
  });
});
