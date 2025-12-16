import { useState, useEffect } from 'react';
import { addLike, removeLike, hasLiked } from '../lib/analytics';

/**
 * Hook to manage likes for a page
 */
export function useLikes(pageId: string | null) {
  const [isLiked, setIsLiked] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!pageId) return;

    const checkLikeStatus = async () => {
      const liked = await hasLiked(pageId);
      setIsLiked(liked);
    };

    checkLikeStatus();
  }, [pageId]);

  const toggleLike = async () => {
    if (!pageId || isLoading) return;

    setIsLoading(true);

    if (isLiked) {
      const result = await removeLike(pageId);
      if (result.success) {
        setIsLiked(false);
      }
    } else {
      const result = await addLike(pageId);
      if (result.success) {
        setIsLiked(true);
      }
    }

    setIsLoading(false);
  };

  return {
    isLiked,
    isLoading,
    toggleLike,
  };
}
