"use client";

import React, { useEffect, useRef, createContext, useContext } from "react";
import Lenis from "lenis";

const SmoothScrollContext = createContext<Lenis | null>(null);

export const useSmoothScroll = () => useContext(SmoothScrollContext);

interface SmoothScrollProps {
  children: React.ReactNode;
  options?: any;
  wrapper?: HTMLElement | null;
  content?: HTMLElement | null;
}

export function SmoothScrollProvider({
  children,
  options,
  wrapper,
  content,
}: SmoothScrollProps) {
  const lenisRef = useRef<Lenis | null>(null);
  const requestRef = useRef<number>(0);

  useEffect(() => {
    // Wait for refs if they are expected
    if (wrapper === null || content === null) return;

    // Initialize Lenis
    const lenis = new Lenis({
      duration: 1.0,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: "vertical",
      gestureOrientation: "vertical",
      smoothWheel: true,
      wheelMultiplier: 1.1,
      touchMultiplier: 2,
      infinite: false,
      wrapper: wrapper || undefined,
      content: content || undefined,
      ...options,
    });

    lenisRef.current = lenis;

    // Animation frame for Lenis
    function raf(time: number) {
      lenis.raf(time);
      requestRef.current = requestAnimationFrame(raf);
    }

    requestRef.current = requestAnimationFrame(raf);

    // Cleanup
    return () => {
      cancelAnimationFrame(requestRef.current);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [options, wrapper, content]);

  return (
    <SmoothScrollContext.Provider value={lenisRef.current}>
      {children}
    </SmoothScrollContext.Provider>
  );
}
