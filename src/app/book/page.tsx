import type { Metadata } from "next";
import { BookApp } from "./book-app";

export const metadata: Metadata = { title: "New booking · Pre-Flight" };

export default function Page() {
  return <BookApp />;
}
