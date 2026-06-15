"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";

export function AuthSync() {
  const { isSignedIn, isLoaded } = useAuth();

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      // Force a hard reload to sync cookies to the server and load the workspace
      window.location.reload();
    }
  }, [isSignedIn, isLoaded]);

  return null;
}
