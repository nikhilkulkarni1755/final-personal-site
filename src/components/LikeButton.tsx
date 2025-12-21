import { Heart } from 'lucide-react';
import { useLikes } from '../hooks/useLikes';

interface LikeButtonProps {
  pageId: string | null;
  likeCount?: number;
}

export default function LikeButton({ pageId, likeCount }: LikeButtonProps) {
  const { isLiked, isLoading, toggleLike } = useLikes(pageId);

  if (!pageId) return null;

  return (
    <button
      onClick={toggleLike}
      disabled={isLoading}
      className={`
        flex items-center gap-2 px-4 py-2 rounded-lg
        transition-all duration-200
        ${
          isLiked
            ? 'bg-red-500 text-white'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
        }
        ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <Heart
        className={`w-5 h-5 ${isLiked ? 'fill-current' : ''}`}
        aria-hidden="true"
      />
      <span className="font-medium">
        {likeCount !== undefined ? `${likeCount} likes` : 'Like'}
      </span>
    </button>
  );
}
