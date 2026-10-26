import type { Metadata } from "next";
import { CheckApp } from "./check-app";

export const metadata: Metadata = { title: "Upload & review · Wheels Up" };

export default function Page() {
  return <CheckApp />;
}
