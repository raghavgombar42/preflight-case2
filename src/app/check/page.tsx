import type { Metadata } from "next";
import { CheckApp } from "./check-app";

export const metadata: Metadata = { title: "Upload & review · Pre-Flight" };

export default function Page() {
  return <CheckApp />;
}
