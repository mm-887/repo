import { Handle, Position, type NodeProps } from '@xyflow/react';

const CodeNode = ({ data }: NodeProps) => {
  const cleanLabel = (label?: string) => {
  if (!label) return 'Unknown';

  const parts = label.split(/[\\/]/); 
  let name = parts[parts.length - 1];
  
  name = name.split(':')[0];
  
  if (name.includes(' as ')) {
    name = name.split(' as ')[0];
  }
  return name;
};


  const getColor = (type?: string) => {
    const t = (type || '').toLowerCase();
    if (t.includes('function')) return 'bg-brand-primary text-zinc-950 border-brand-primary/50';
    if (t.includes('class')) return 'bg-indigo-500 text-white border-indigo-400';
    if (t.includes('module') || t.includes('file')) return 'bg-zinc-700 text-zinc-200 border-zinc-600';
    return 'bg-zinc-800 text-zinc-300 border-zinc-700'; 
  };

  const colorClass = getColor(data.type as string | undefined);

  return (
    <div className="group relative">
      <Handle type="target" position={Position.Top} className="w-2 h-2 bg-zinc-600" />
      
      <div className={`
        w-max px-4 py-2 rounded-full border-2 shadow-lg transition-all duration-200 
        group-hover:scale-110 group-hover:shadow-brand-primary/20
        ${colorClass}
      `}>
        <div className="flex flex-col items-center justify-center text-center">
          <span className="text-[10px] uppercase font-bold opacity-70 leading-none mb-1">
            {(data.type as string) || 'node'}
          </span>
          <span className="text-xs font-semibold whitespace-nowrap">
            {cleanLabel(data.label as string | undefined)}
          </span>
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="w-2 h-2 bg-zinc-600" />
    </div>
  );
};

export default CodeNode;
