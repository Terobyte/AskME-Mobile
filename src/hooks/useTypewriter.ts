import { useState, useEffect, useRef } from 'react';

export const useTypewriter = (text: string, speed: number = 30) => {
  const [displayedText, setDisplayedText] = useState("");
  const index = useRef(0);
  const timer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Reset when text changes drastically (new message)
    // If text just appends (streaming), we might want to continue, but for now 
    // we assume 'text' is the full final message or the growing message.
    // Simpler approach: If text is empty, reset.
    // If text is new (different start), reset.
    
    // For this use case (Gemini returns full block), we treat any new 'text' prop 
    // that is DIFFERENT from the fully displayed text as a new animation trigger 
    // OR we just sync if it's strictly longer.
    
    // Actually, simpler logic:
    // If text changes and displayedText is NOT a substring of text, reset.
    if (!text.startsWith(displayedText)) {
        setDisplayedText("");
        index.current = 0;
    }
    
    if (timer.current) clearInterval(timer.current);

    timer.current = setInterval(() => {
      if (index.current < text.length) {
        setDisplayedText((prev) => text.substring(0, index.current + 1));
        index.current++;
      } else {
        if (timer.current) clearInterval(timer.current);
      }
    }, speed);

    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [text, speed]);

  return displayedText;
};
