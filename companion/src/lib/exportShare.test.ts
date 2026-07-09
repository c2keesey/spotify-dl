import { pickExportMethod } from "@/lib/exportShare";

const files = [new File(["{}"], "s cues.json", { type: "application/json" })];

describe("pickExportMethod", () => {
  test("shares when share exists and canShare({files}) is true", () => {
    const nav = { share: async () => {}, canShare: () => true };
    expect(pickExportMethod(nav, files)).toBe("share");
  });

  test("downloads when canShare({files}) is false (files not shareable)", () => {
    const nav = { share: async () => {}, canShare: () => false };
    expect(pickExportMethod(nav, files)).toBe("download");
  });

  test("downloads when canShare is absent even if share exists", () => {
    const nav = { share: async () => {} };
    expect(pickExportMethod(nav, files)).toBe("download");
  });

  test("downloads when share is absent", () => {
    const nav = { canShare: () => true };
    expect(pickExportMethod(nav, files)).toBe("download");
  });

  test("downloads for an empty navigator", () => {
    expect(pickExportMethod({}, files)).toBe("download");
  });

  test("passes the files through to canShare", () => {
    let seen: File[] | null = null;
    const nav = {
      share: async () => {},
      canShare: (data: { files: File[] }) => {
        seen = data.files;
        return true;
      },
    };
    pickExportMethod(nav, files);
    expect(seen).toBe(files);
  });
});
