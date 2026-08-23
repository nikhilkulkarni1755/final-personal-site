import { useMemo } from 'react';
import { FileCode, FileText, Folder } from 'lucide-react';
import type { CorpusFile } from './types';

interface FileTreeProps {
  files: CorpusFile[];
  selected: string;
  dirtyPaths: Set<string>;
  onSelect: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  file?: CorpusFile;
}

const buildTree = (files: CorpusFile[]): TreeNode => {
  const root: TreeNode = { name: '', path: '', children: new Map() };
  files.forEach((file) => {
    const parts = file.path.split('/');
    let node = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join('/');
      if (!node.children.has(part)) node.children.set(part, { name: part, path, children: new Map() });
      node = node.children.get(part)!;
      if (index === parts.length - 1) node.file = file;
    });
  });
  return root;
};

const iconFor = (path: string) =>
  /\.(py|js|ts|tsx|css|html)$/.test(path) ? FileCode : FileText;

/**
 * FileTree - the project as the visitor sees it.
 *
 * A dot marks a file the visitor has changed. Those changes live only in this
 * browser tab, and they are also why the prefix stops matching the cached one —
 * the workbench header explains that consequence.
 */
const FileTree = ({ files, selected, dirtyPaths, onSelect }: FileTreeProps) => {
  const tree = useMemo(() => buildTree(files), [files]);

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const entries = [...node.children.values()].sort((a, b) => {
      const aIsDir = a.children.size > 0;
      const bIsDir = b.children.size > 0;
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return entries.map((child) => {
      if (child.children.size > 0) {
        return (
          <div key={child.path}>
            <div
              className="flex items-center gap-1.5 py-1 text-[12px] text-[#001F3F]/55 dark:text-white/50"
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
            >
              <Folder className="h-3.5 w-3.5 shrink-0" />
              <span>{child.name}</span>
            </div>
            {renderNode(child, depth + 1)}
          </div>
        );
      }

      const isSelected = child.path === selected;
      const isDirty = dirtyPaths.has(child.path);
      const Icon = iconFor(child.path);
      return (
        <button
          key={child.path}
          type="button"
          onClick={() => onSelect(child.path)}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          className={`flex w-full items-center gap-1.5 py-1 pr-2 text-left text-[12px] transition-colors ${
            isSelected
              ? 'bg-[#001F3F]/[0.07] font-medium text-[#001F3F] dark:bg-white/10 dark:text-white'
              : 'text-[#001F3F]/70 hover:bg-[#001F3F]/[0.04] dark:text-white/65 dark:hover:bg-white/[0.05]'
          }`}
        >
          <Icon className="h-3.5 w-3.5 shrink-0 opacity-60" />
          <span className="truncate">{child.name}</span>
          {isDirty && (
            <span
              title="changed locally — your prefix no longer matches the cached one"
              className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[#F4A340]"
            />
          )}
        </button>
      );
    });
  };

  const totalLines = files.reduce((sum, file) => sum + file.lines, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#001F3F]/10 px-3 py-2 dark:border-white/10">
        <p className="font-mono text-[11px] font-semibold text-[#001F3F] dark:text-white">docscribe/</p>
        <p className="text-[10px] text-[#001F3F]/40 dark:text-white/35">
          {files.length} files · {totalLines.toLocaleString()} lines
        </p>
      </div>
      <div className="flex-1 overflow-auto py-1">{renderNode(tree, 0)}</div>
    </div>
  );
};

export default FileTree;
