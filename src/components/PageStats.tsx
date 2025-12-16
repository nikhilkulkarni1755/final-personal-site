import { Eye, Heart, MessageCircle } from 'lucide-react';

interface PageStatsProps {
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
}

export default function PageStats({
  viewCount,
  likeCount,
  commentCount,
}: PageStatsProps) {
  const stats = [
    { icon: Eye, label: 'Views', value: viewCount },
    { icon: Heart, label: 'Likes', value: likeCount },
    { icon: MessageCircle, label: 'Comments', value: commentCount },
  ].filter(stat => stat.value !== undefined);

  if (stats.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-400">
      {stats.map(({ icon: Icon, label, value }) => (
        <div key={label} className="flex items-center gap-1.5">
          <Icon className="w-4 h-4" />
          <span>
            {value?.toLocaleString()} {label}
          </span>
        </div>
      ))}
    </div>
  );
}
