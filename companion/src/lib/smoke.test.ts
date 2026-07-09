import { cn } from "@/lib/utils";
test("cn merges classes", () => { expect(cn("a", false && "b", "c")).toBe("a c"); });
