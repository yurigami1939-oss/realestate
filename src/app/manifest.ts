import type { MetadataRoute } from "next";

import fr from "../../messages/fr.json";

/**
 * Web app manifest (CLAUDE.md §4): the back office and the portal install on a phone or a
 * desktop as an app opening on its own window; `/` sends each member to their language and
 * home (dashboard or portal).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: fr.metadata.title,
    short_name: fr.metadata.title,
    description: fr.metadata.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f5f9",
    theme_color: "#13224a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
