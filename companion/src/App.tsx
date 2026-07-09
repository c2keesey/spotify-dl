import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ImportScreen from "@/screens/ImportScreen";

// The whole app is three offline screens with no URLs to deep-link, so screen
// state is a plain discriminated union in useState — no router.
type Screen =
  | { name: "import" }
  | { name: "set"; stem: string }
  | { name: "track"; stem: string; trackId: string };

// Placeholders until Task 8 (Set) / Task 9 (Track) land.
function ComingSoon({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <main className="grain min-h-dvh flex flex-col items-center justify-center p-6">
      <Card className="bevel w-full max-w-md">
        <CardHeader>
          <p className="panel-label">Flight Deck</p>
          <CardTitle className="font-display text-2xl tracking-tight text-led led-glow">
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Coming online in a later build.</p>
          <Button variant="outline" onClick={onBack}>
            Back to Import
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "import" });

  switch (screen.name) {
    case "import":
      return <ImportScreen onOpenSet={(stem) => setScreen({ name: "set", stem })} />;
    case "set":
      return <ComingSoon title="Set" onBack={() => setScreen({ name: "import" })} />;
    case "track":
      return <ComingSoon title="Track" onBack={() => setScreen({ name: "import" })} />;
  }
}
