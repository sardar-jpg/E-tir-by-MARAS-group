/** Layout-matching loading skeleton for the whole Dashboard Overview. */
export default function DashboardSkeleton() {
  const box = "animate-pulse rounded-2xl border border-slate-200 bg-white";
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading dashboard">
      <div className="flex items-center justify-between">
        <div className="h-8 w-56 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-8 w-40 animate-pulse rounded-lg bg-slate-100" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className={`${box} h-28`} />)}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className={`${box} h-[420px] lg:col-span-5`} />
        <div className={`${box} h-[420px] lg:col-span-3`} />
        <div className={`${box} h-[420px] lg:col-span-4`} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className={`${box} h-80 lg:col-span-8`} />
        <div className={`${box} h-80 lg:col-span-4`} />
      </div>
    </div>
  );
}
