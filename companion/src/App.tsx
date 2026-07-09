import { useState } from "react";
import ImportScreen from "@/screens/ImportScreen";
import SetScreen from "@/screens/SetScreen";
import TrackScreen from "@/screens/TrackScreen";

// The whole app is three offline screens with no URLs to deep-link, so screen
// state is a plain discriminated union in useState — no router.
type Screen =
  | { name: "import" }
  | { name: "set"; stem: string }
  | { name: "track"; stem: string; trackId: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "import" });

  switch (screen.name) {
    case "import":
      return <ImportScreen onOpenSet={(stem) => setScreen({ name: "set", stem })} />;
    case "set":
      return (
        <SetScreen
          stem={screen.stem}
          onOpenTrack={(trackId) => setScreen({ name: "track", stem: screen.stem, trackId })}
          onBack={() => setScreen({ name: "import" })}
        />
      );
    case "track":
      return (
        <TrackScreen
          stem={screen.stem}
          trackId={screen.trackId}
          onBack={() => setScreen({ name: "set", stem: screen.stem })}
        />
      );
  }
}
