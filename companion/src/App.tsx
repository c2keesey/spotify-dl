import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// The whole app is three offline screens with no URLs to deep-link, so screen
// state is a plain discriminated union in useState — no router.
type Screen =
  | { name: "import" }
  | { name: "set" }
  | { name: "track"; trackId: string };

function ImportScreen() {
  return (
    <main className="grain min-h-dvh flex flex-col items-center justify-center p-6">
      <Card className="bevel w-full max-w-md">
        <CardHeader>
          <p className="panel-label">Flight Deck</p>
          <CardTitle className="font-display text-3xl tracking-tight text-led led-glow">
            Flightcase
          </CardTitle>
          <CardDescription>
            AirDrop a <code>.crate</code> bundle from Crate, then place hot cues
            and loops while you fly. Your work comes home as rekordbox hot cues.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Import screen — coming online in a later build.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

export default function App() {
  const [screen] = useState<Screen>({ name: "import" });

  switch (screen.name) {
    case "import":
      return <ImportScreen />;
    case "set":
      return <ImportScreen />;
    case "track":
      return <ImportScreen />;
  }
}
