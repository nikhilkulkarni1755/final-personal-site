import { Eye } from 'lucide-react';

interface ActiveViewersProps {
  count: number;
}

export default function ActiveViewers({ count }: ActiveViewersProps) {
  if (count === 0) return null;

  return (
    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
      <Eye className="w-4 h-4" />
      <span>
        {count} {count === 1 ? 'person' : 'people'} viewing now
      </span>
    </div>
  );
}
