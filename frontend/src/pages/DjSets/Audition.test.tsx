import { render, screen, fireEvent } from "@testing-library/react";
import { beforeAll, vi } from "vitest";
import type { DjTrack } from "@/lib/types";
import { AuditionProvider, AuditionButton } from "./Audition";

// jsdom does not implement media playback; stub the element methods so the
// component's calls don't throw and we can assert playback was attempted.
beforeAll(() => {
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
  window.HTMLMediaElement.prototype.load = vi.fn();
});

function track(kw: Partial<DjTrack> = {}): DjTrack {
  return {
    id: "1", title: "Song", artist: "Artist", bpm: 124, key_name: "Am",
    camelot: "8A", genre: "House", file_path: "/lib/a.mp3", file_state: "present",
    duration: 300, status: "analyzed", playlists: [], ...kw,
  };
}

function setup(t: DjTrack) {
  return render(
    <AuditionProvider>
      <AuditionButton track={t} />
    </AuditionProvider>,
  );
}

it("disables the control for a file that is not on disk", () => {
  setup(track({ id: "2", file_state: "missing" }));
  const btn = screen.getByRole("button", { name: /can't audition/i });
  expect(btn).toBeDisabled();
});

it("offers an enabled Audition control for a present file", () => {
  setup(track());
  const btn = screen.getByRole("button", { name: /^audition song$/i });
  expect(btn).toBeEnabled();
});

it("starts playback and shows the transport bar when clicked", () => {
  const { container } = setup(track());
  expect(screen.queryByText(/audition/i)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^audition song$/i }));
  // src points at the id-resolving audio endpoint (never a raw path)
  const audio = container.querySelector("audio")!;
  expect(audio.getAttribute("src")).toBe("/api/dj/audio/1");
  expect(window.HTMLMediaElement.prototype.load).toHaveBeenCalled();
  // the transport panel now names the track
  expect(screen.getByText("Song")).toBeInTheDocument();
  expect(screen.getByText(/paused|playing/i)).toBeInTheDocument();
});

it("reflects the play event as a Pause affordance", () => {
  const { container } = setup(track());
  fireEvent.click(screen.getByRole("button", { name: /^audition song$/i }));
  fireEvent(container.querySelector("audio")!, new Event("play"));
  expect(screen.getByRole("button", { name: /^pause song$/i })).toBeInTheDocument();
  expect(screen.getByText(/playing/i)).toBeInTheDocument();
});

it("shows a visible error when the file fails to load", () => {
  const { container } = setup(track());
  fireEvent.click(screen.getByRole("button", { name: /^audition song$/i }));
  fireEvent(container.querySelector("audio")!, new Event("error"));
  expect(screen.getByText(/couldn't be played/i)).toBeInTheDocument();
});
