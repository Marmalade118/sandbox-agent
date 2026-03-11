"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Download, Monitor, ChevronDown } from "lucide-react";

const DOWNLOAD_BASE = "https://releases.rivet.dev/foundry/0.1.0";

type Platform = {
  label: string;
  arch: string;
  filename: string;
};

const PLATFORMS: Platform[] = [
  {
    label: "macOS (Apple Silicon)",
    arch: "arm64",
    filename: "Foundry_0.1.0_aarch64.dmg",
  },
  {
    label: "macOS (Intel)",
    arch: "x64",
    filename: "Foundry_0.1.0_x64.dmg",
  },
];

function detectPlatform(): Platform | null {
  if (typeof navigator === "undefined") return null;

  const ua = navigator.userAgent.toLowerCase();
  if (!ua.includes("mac")) return null;

  // Apple Silicon detection: check for arm in platform or userAgentData
  const isArm = navigator.platform === "MacIntel" && (navigator as any).userAgentData?.architecture === "arm";
  // Fallback: newer Safari/Chrome on Apple Silicon
  const couldBeArm = navigator.platform === "MacIntel" && !ua.includes("intel");

  if (isArm || couldBeArm) {
    return PLATFORMS[0]; // Apple Silicon
  }
  return PLATFORMS[1]; // Intel
}

export function DownloadFoundry() {
  const [detected, setDetected] = useState<Platform | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    setDetected(detectPlatform());
  }, []);

  const primary = detected ?? PLATFORMS[0];
  const secondary = PLATFORMS.filter((p) => p !== primary);

  return (
    <section className="border-t border-white/10 py-48">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12 text-center">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mb-4 text-2xl font-normal tracking-tight text-white md:text-4xl"
          >
            Download Foundry
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mx-auto max-w-xl text-base leading-relaxed text-zinc-500"
          >
            Run Foundry as a native desktop app. Manage workspaces, handoffs, and coding agents locally.
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mx-auto flex max-w-md flex-col items-center gap-4"
        >
          {/* Primary download button */}
          <a
            href={`${DOWNLOAD_BASE}/${primary.filename}`}
            className="inline-flex w-full items-center justify-center gap-3 rounded-xl bg-white px-8 py-4 text-base font-medium text-black transition-colors hover:bg-zinc-200"
          >
            <Download className="h-5 w-5" />
            Download for {primary.label}
          </a>

          {/* Other platforms */}
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="inline-flex items-center gap-2 text-sm text-zinc-500 transition-colors hover:text-white"
            >
              <Monitor className="h-4 w-4" />
              Other platforms
              <ChevronDown className={`h-3 w-3 transition-transform ${showDropdown ? "rotate-180" : ""}`} />
            </button>

            {showDropdown && (
              <div className="absolute left-1/2 top-full mt-2 -translate-x-1/2 rounded-lg border border-white/10 bg-zinc-900 p-2 shadow-xl">
                {secondary.map((p) => (
                  <a
                    key={p.arch}
                    href={`${DOWNLOAD_BASE}/${p.filename}`}
                    className="block whitespace-nowrap rounded-md px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    {p.label}
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Unsigned app note */}
          <p className="mt-4 text-center text-xs leading-relaxed text-zinc-600">
            macOS only. On first launch, right-click the app and select "Open" to bypass Gatekeeper.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
