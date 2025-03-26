import { useEffect, useRef, type RefObject, useCallback } from "react";

// Helper function to throttle function calls
function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return function (this: any, ...args: Parameters<T>) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Custom hook for auto-scrolling to the bottom of a container when content changes.
 *
 * IMPORTANT: This hook had a critical fix to prevent unwanted scrolling when hovering over
 * interactive elements. Previously, the MutationObserver would detect attribute changes
 * from hover states and trigger scrolling, making UI interaction difficult.
 *
 * The fix:
 * 1. Removed 'attributes' from MutationObserver config
 * 2. Added hover detection to prevent scrolling when user is interacting
 * 3. Only scroll on actual content additions, not attribute changes
 * 4. Throttled scrolling to prevent rapid consecutive scrolls
 */
export function useScrollToBottom<T extends HTMLElement>(): [
  RefObject<T>,
  RefObject<T>,
  (messageId: string) => void
] {
  const containerRef = useRef<T>(null);
  const endRef = useRef<T>(null);
  // Track if we're currently in a manual scroll operation to prevent recursive scrolling
  const isManuallyScrolling = useRef(false);

  // Use a ref to keep track of whether we've recently scrolled
  const recentlyScrolled = useRef(false);

  // Add a ref to track hovering state
  const isHovering = useRef(false);

  // Store the last known mutation timestamp for internal tracking
  const lastMutationTime = useRef(Date.now());

  useEffect(() => {
    const container = containerRef.current;
    const end = endRef.current;

    if (container && end) {
      // Add identifier to help with component debugging if needed
      const containerId = Math.random().toString(36).substring(2, 8);
      container.setAttribute("data-scroll-container-id", containerId);

      // Throttled scroll function to prevent too many scrolls
      const performScroll = throttle(() => {
        // Don't scroll if user is hovering or manually scrolling
        if (isHovering.current || isManuallyScrolling.current) {
          return;
        }

        // Set the recently scrolled flag
        recentlyScrolled.current = true;

        // Actual scroll
        end.scrollIntoView({ behavior: "instant", block: "end" });

        // Reset the flag after a delay
        setTimeout(() => {
          recentlyScrolled.current = false;
        }, 1000);
      }, 500); // Only allow scroll once every 500ms

      // Add hover detection
      const mouseEnterHandler = () => {
        isHovering.current = true;
      };

      const mouseLeaveHandler = () => {
        isHovering.current = false;
      };

      container.addEventListener("mouseenter", mouseEnterHandler);
      container.addEventListener("mouseleave", mouseLeaveHandler);

      // Setup MutationObserver for content changes only
      const observer = new MutationObserver((mutations) => {
        // Completely ignore mutations if we're in a manual operation
        if (isManuallyScrolling.current) {
          return;
        }

        // Check for actual content additions (not style/attribute changes)
        const hasNewContent = mutations.some((mutation) => {
          // Only consider childList mutations that ADD nodes
          return (
            mutation.type === "childList" && mutation.addedNodes.length > 0
          );
        });

        // Only scroll on meaningful content changes
        if (hasNewContent) {
          lastMutationTime.current = Date.now();
          performScroll();
        }
      });

      // Configure the observer to ONLY watch for content changes
      observer.observe(container, {
        childList: true, // Watch for changes to direct children
        subtree: true, // Watch for changes in descendant nodes
        characterData: true, // Watch for changes to text content
        // Explicitly NOT watching for attribute changes which caused the hover issue
      });

      return () => {
        observer.disconnect();
        container.removeEventListener("mouseenter", mouseEnterHandler);
        container.removeEventListener("mouseleave", mouseLeaveHandler);
      };
    }
  }, []);

  // Function to scroll to a specific message by ID
  const scrollToMessage = useCallback((messageId: string) => {
    if (!messageId) return;

    // Set flag to prevent MutationObserver from triggering during manual scroll
    isManuallyScrolling.current = true;

    // Find the message element by its data-message-id attribute
    const messageElement = document.querySelector(
      `[data-message-id="${messageId}"]`
    );

    if (messageElement) {
      // Use scrollIntoView to scroll to the message
      messageElement.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }

    // Reset the flag after scrolling is complete
    setTimeout(() => {
      isManuallyScrolling.current = false;
    }, 1000);
  }, []);

  return [containerRef, endRef, scrollToMessage];
}
