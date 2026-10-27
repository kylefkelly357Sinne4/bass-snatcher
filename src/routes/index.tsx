import { createFileRoute } from "@tanstack/react-router";
import { BassSnatcher } from "@/components/bass-snatcher";

export const Route = createFileRoute("/")({
  component: BassSnatcher,
});
