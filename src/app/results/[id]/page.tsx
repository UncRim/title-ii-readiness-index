import type { Metadata } from "next";
import { Suspense } from "react";

import { ResultsClient } from "./ResultsClient";

export const metadata: Metadata = {
  title: "Scan results — ADA Title II readiness",
  description:
    "A plain-language summary of a readiness scan: what was found, which sites could not be tested, and what to do next.",
};

// Reading the route parameter is runtime data, so it sits inside a Suspense boundary.
// The fallback shows right away while the id is read.
async function Results({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ResultsClient id={id} />;
}

export default function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-10">
          <p className="text-body-regular text-text-secondary" role="status">
            Loading results…
          </p>
        </div>
      }
    >
      <Results params={params} />
    </Suspense>
  );
}
