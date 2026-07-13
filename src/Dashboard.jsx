import React, { useState, useMemo } from 'react';
import {
  LayoutDashboard, ListTodo, CalendarDays, TrendingUp, Users,
  CheckCircle2, XCircle, Clock, Plus, Search, ChevronDown,
  Headphones, Settings2, Banknote, ArrowUpRight, Filter,
  Star, Award, Target, AlertCircle, MoreHorizontal, X, Check,
  UserCircle2, LogOut, Sparkles,
  UserPlus, BookOpen, Building2, Pill as PillIcon, Truck,
  BarChart3, Gauge, FileText, Settings, Globe, PhoneCall,
  Megaphone, Briefcase, Wrench
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, RadialBarChart, RadialBar, PolarAngleAxis,
  AreaChart, Area
} from 'recharts';

// ─────────────────────────────────────────────────────────────
// FONTS  (loaded via <style> tag inside component)
// ─────────────────────────────────────────────────────────────
const FontStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Reem+Kufi:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700&family=Frank+Ruhl+Libre:wght@500;700;800&display=swap');

    .font-display { font-family: 'Reem Kufi', serif; letter-spacing: -0.01em; }
    .font-body { font-family: 'IBM Plex Sans Arabic', sans-serif; }
    .font-latin-serif { font-family: 'Frank Ruhl Libre', serif; }

    *::-webkit-scrollbar { width: 6px; height: 6px; }
    *::-webkit-scrollbar-track { background: transparent; }
    *::-webkit-scrollbar-thumb { background: #d4cfc0; border-radius: 999px; }

    @keyframes slideIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .anim-slide { animation: slideIn 0.4s ease-out backwards; }

    @keyframes shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }

    .grain::before {
      content: '';
      position: absolute;
      inset: 0;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E");
      pointer-events: none;
      mix-blend-mode: multiply;
    }
  `}</style>
);

// ─────────────────────────────────────────────────────────────
// MOCK DATA
// ─────────────────────────────────────────────────────────────
// Master Teams — الفرق الأساسية المثبتة في النظام.
// إضافة أي فريق جديد مستقبلاً تتم بإضافة سطر هنا فقط، بدون أي تعديل في الكود.
const TEAMS = {
  cc:  { id: 'cc',  name: 'فريق خدمة العملاء',      nameEn: 'Customer Care Team',    color: '#2d5d6e', soft: '#dfe9ec', icon: Headphones },
  oo:  { id: 'oo',  name: 'فريق العمليات الأونلاين', nameEn: 'Online Operation Team', color: '#a86b2c', soft: '#f0e3d2', icon: Globe },
  ts:  { id: 'ts',  name: 'فريق التيلي سيلز',        nameEn: 'Telesales Team',        color: '#8b3a4e', soft: '#ecd9de', icon: PhoneCall },
  ost: { id: 'ost', name: 'فريق OST',                nameEn: 'OST',                   color: '#3d7a4f', soft: '#dce8df', icon: Briefcase },
  bex: { id: 'bex', name: 'تميز الأعمال',            nameEn: 'Business Excellence',   color: '#4f5d8b', soft: '#dfe2ee', icon: Award },
  mkt: { id: 'mkt', name: 'فريق التسويق',            nameEn: 'Marketing Team',        color: '#b0583d', soft: '#f2ded5', icon: Megaphone },
};

const EMPLOYEES = [
  { id: 1, name: 'محمد أحمد',     team: 'cc',  role: 'أخصائي خدمة عملاء', avatar: 'م.أ', score: 92, joined: '2023' },
  { id: 2, name: 'سارة إبراهيم',  team: 'cc',  role: 'مشرفة دعم',         avatar: 'س.إ', score: 88, joined: '2022' },
  { id: 3, name: 'عمر خالد',      team: 'oo',  role: 'منسق عمليات',       avatar: 'ع.خ', score: 76, joined: '2024' },
  { id: 4, name: 'ليلى حسن',      team: 'oo',  role: 'أخصائي جودة',       avatar: 'ل.ح', score: 95, joined: '2021' },
  { id: 5, name: 'يوسف منصور',    team: 'ts',  role: 'مندوب تيلي سيلز',   avatar: 'ي.م', score: 81, joined: '2023' },
  { id: 6, name: 'هدى ناصر',      team: 'ts',  role: 'كبير التيلي سيلز',  avatar: 'ه.ن', score: 89, joined: '2020' },
];

const INITIAL_TASKS = [
  { id: 1, title: 'مراجعة شكاوى العملاء لشهر مايو',         assignee: 1, team: 'cc', priority: 'عالية',  status: 'قيد التنفيذ', due: '٢٨ مايو' },
  { id: 2, title: 'إعداد تقرير رضا العملاء الأسبوعي',       assignee: 2, team: 'cc', priority: 'متوسطة', status: 'قيد التنفيذ', due: '٣٠ مايو' },
  { id: 3, title: 'تحديث دليل إجراءات التشغيل',             assignee: 3, team: 'oo', priority: 'منخفضة', status: 'لم تبدأ',     due: '٥ يونيو' },
  { id: 4, title: 'فحص جودة الشحنات الواردة',               assignee: 4, team: 'oo', priority: 'عالية',  status: 'مكتملة',      due: '٢٥ مايو' },
  { id: 5, title: 'متابعة عملاء الشهر الحاليين',           assignee: 5, team: 'ts', priority: 'عالية',  status: 'قيد التنفيذ', due: '٢٩ مايو' },
  { id: 6, title: 'إعداد عرض تقديمي للعميل الجديد',        assignee: 6, team: 'ts', priority: 'متوسطة', status: 'قيد التنفيذ', due: '٢ يونيو' },
  { id: 7, title: 'الرد على تذاكر الدعم المتأخرة',          assignee: 1, team: 'cc', priority: 'عالية',  status: 'لم تبدأ',     due: '٢٧ مايو' },
  { id: 8, title: 'تحليل أداء فريق التيلي سيلز',           assignee: 6, team: 'ts', priority: 'متوسطة', status: 'مكتملة',      due: '٢٤ مايو' },
];

const INITIAL_LEAVES = [
  { id: 1, employee: 1, type: 'إجازة اعتيادية',  from: '٣ يونيو',  to: '٥ يونيو',  days: 3, status: 'معلقة',   reason: 'مناسبة عائلية' },
  { id: 2, employee: 3, type: 'إجازة مرضية',     from: '٢٦ مايو',  to: '٢٦ مايو',  days: 1, status: 'مقبولة',  reason: 'موعد طبي' },
  { id: 3, employee: 5, type: 'إجازة اعتيادية',  from: '١٠ يونيو', to: '١٤ يونيو', days: 5, status: 'معلقة',   reason: 'سفر' },
  { id: 4, employee: 2, type: 'إجازة طارئة',     from: '٢٢ مايو',  to: '٢٢ مايو',  days: 1, status: 'مرفوضة',  reason: 'ظرف شخصي' },
  { id: 5, employee: 4, type: 'إجازة اعتيادية',  from: '١ يوليو',  to: '٧ يوليو',  days: 7, status: 'معلقة',   reason: 'إجازة سنوية' },
];

// Mock weekly performance data for the logged-in employee
const PERF_WEEKLY = [
  { d: 'سبت',    val: 78 },
  { d: 'أحد',    val: 82 },
  { d: 'إثنين',  val: 85 },
  { d: 'ثلاثاء', val: 80 },
  { d: 'أربعاء', val: 91 },
  { d: 'خميس',   val: 88 },
];

const TASK_TREND = [
  { m: 'يناير',   completed: 12, assigned: 18 },
  { m: 'فبراير',  completed: 16, assigned: 20 },
  { m: 'مارس',    completed: 19, assigned: 22 },
  { m: 'أبريل',   completed: 21, assigned: 24 },
  { m: 'مايو',    completed: 24, assigned: 28 },
];

// ─────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────
const STATUS_STYLES = {
  'قيد التنفيذ': { bg: '#f0e3d2', text: '#7a4d1d', dot: '#a86b2c' },
  'مكتملة':      { bg: '#dce8df', text: '#2a5236', dot: '#3d7a4f' },
  'لم تبدأ':     { bg: '#e8e3d8', text: '#5c5141', dot: '#857961' },
  'معلقة':       { bg: '#f0e3d2', text: '#7a4d1d', dot: '#a86b2c' },
  'مقبولة':      { bg: '#dce8df', text: '#2a5236', dot: '#3d7a4f' },
  'مرفوضة':      { bg: '#ecd9de', text: '#7a2d3e', dot: '#8b3a4e' },
};

const PRIORITY_STYLES = {
  'عالية':  '#8b3a4e',
  'متوسطة': '#a86b2c',
  'منخفضة': '#857961',
};

// ─────────────────────────────────────────────────────────────
// SHARED COMPONENTS
// ─────────────────────────────────────────────────────────────
const Pill = ({ children, status, bg, color }) => {
  const s = status ? STATUS_STYLES[status] : null;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{ background: bg || s?.bg, color: color || s?.text }}
    >
      {s && <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }} />}
      {children}
    </span>
  );
};

const Avatar = ({ emp, size = 36 }) => {
  const team = TEAMS[emp.team];
  return (
    <div
      className="flex items-center justify-center rounded-full font-display font-semibold shrink-0"
      style={{
        width: size, height: size,
        background: team.soft, color: team.color,
        fontSize: size * 0.36
      }}
    >
      {emp.avatar}
    </div>
  );
};

const Card = ({ children, className = '', style }) => (
  <div
    className={`bg-[#fbf8f0] border border-[#e8e1cf] rounded-2xl ${className}`}
    style={style}
  >
    {children}
  </div>
);

const SectionHeader = ({ eyebrow, title, action }) => (
  <div className="flex items-end justify-between mb-6">
    <div>
      <div className="text-xs uppercase tracking-[0.2em] text-[#857961] mb-2 font-latin-serif">
        {eyebrow}
      </div>
      <h2 className="font-display text-3xl text-[#1a1d2e] font-medium">{title}</h2>
    </div>
    {action}
  </div>
);

// ─────────────────────────────────────────────────────────────
// MODERATOR VIEWS
// ─────────────────────────────────────────────────────────────
const ModeratorOverview = ({ tasks, leaves }) => {
  const pendingLeaves = leaves.filter(l => l.status === 'معلقة').length;
  const inProgress = tasks.filter(t => t.status === 'قيد التنفيذ').length;
  const completed = tasks.filter(t => t.status === 'مكتملة').length;
  const completionRate = Math.round((completed / tasks.length) * 100);

  const teamStats = Object.values(TEAMS).map(team => {
    const teamTasks = tasks.filter(t => t.team === team.id);
    const done = teamTasks.filter(t => t.status === 'مكتملة').length;
    return {
      ...team,
      total: teamTasks.length,
      done,
      rate: teamTasks.length ? Math.round((done / teamTasks.length) * 100) : 0,
      members: EMPLOYEES.filter(e => e.team === team.id).length
    };
  });

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="OVERVIEW · لوحة المتابعة"
        title="نظرة عامة على الأداء"
        action={
          <div className="text-sm text-[#857961] font-body">
            {new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'إجمالي المهام',    value: tasks.length,    sub: `${inProgress} قيد التنفيذ`, color: '#1a1d2e' },
          { label: 'نسبة الإنجاز',    value: `${completionRate}%`, sub: `${completed} مكتملة`,    color: '#3d7a4f' },
          { label: 'طلبات إجازة معلقة', value: pendingLeaves,   sub: 'تحتاج مراجعة',                color: '#a86b2c' },
          { label: 'إجمالي الموظفين',  value: EMPLOYEES.length, sub: `${Object.keys(TEAMS).length} فرق`,  color: '#8b3a4e' },
        ].map((kpi, i) => (
          <Card key={i} className="p-5 anim-slide" style={{ animationDelay: `${i * 80}ms` }}>
            <div className="text-xs text-[#857961] mb-3 font-body">{kpi.label}</div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-4xl font-semibold" style={{ color: kpi.color }}>
                {kpi.value}
              </span>
            </div>
            <div className="text-xs text-[#857961] mt-2 font-body">{kpi.sub}</div>
          </Card>
        ))}
      </div>

      {/* Two-column: team breakdown + chart */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-6 col-span-2">
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-[#857961] font-latin-serif mb-1">
                MONTHLY TREND
              </div>
              <div className="font-display text-lg text-[#1a1d2e]">المهام المُسندة مقابل المُنجزة</div>
            </div>
            <Pill bg="#dce8df" color="#2a5236">آخر 5 شهور</Pill>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={TASK_TREND} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#a86b2c" stopOpacity={0.35}/>
                  <stop offset="100%" stopColor="#a86b2c" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="gc" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#3d7a4f" stopOpacity={0.35}/>
                  <stop offset="100%" stopColor="#3d7a4f" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke="#e8e1cf" vertical={false}/>
              <XAxis dataKey="m" stroke="#857961" fontSize={11} tickLine={false} axisLine={false} reversed/>
              <YAxis stroke="#857961" fontSize={11} tickLine={false} axisLine={false} orientation="right"/>
              <Tooltip
                contentStyle={{
                  background: '#fbf8f0', border: '1px solid #e8e1cf',
                  borderRadius: 12, fontFamily: 'IBM Plex Sans Arabic'
                }}
              />
              <Area type="monotone" dataKey="assigned"  stroke="#a86b2c" strokeWidth={2} fill="url(#ga)" name="مُسندة"/>
              <Area type="monotone" dataKey="completed" stroke="#3d7a4f" strokeWidth={2} fill="url(#gc)" name="مُنجزة"/>
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-6">
          <div className="text-xs uppercase tracking-[0.2em] text-[#857961] font-latin-serif mb-1">TEAMS</div>
          <div className="font-display text-lg text-[#1a1d2e] mb-5">أداء الفرق</div>
          <div className="space-y-5">
            {teamStats.map(t => {
              const Icon = t.icon;
              return (
                <div key={t.id}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center"
                        style={{ background: t.soft, color: t.color }}
                      >
                        <Icon size={14}/>
                      </div>
                      <span className="font-body text-sm text-[#1a1d2e]">{t.name}</span>
                    </div>
                    <span className="font-display text-sm font-semibold" style={{ color: t.color }}>
                      {t.rate}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-[#e8e1cf] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${t.rate}%`, background: t.color }}
                    />
                  </div>
                  <div className="text-xs text-[#857961] mt-1.5 font-body">
                    {t.members} أعضاء · {t.done}/{t.total} مهمة
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
};

// ─── Tasks management (moderator) ─────────────────────────────
const ModeratorTasks = ({ tasks, setTasks }) => {
  const [filterTeam, setFilterTeam] = useState('all');
  const [showNew, setShowNew] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', assignee: 1, priority: 'متوسطة', due: '' });

  const filtered = filterTeam === 'all' ? tasks : tasks.filter(t => t.team === filterTeam);

  const addTask = () => {
    if (!newTask.title.trim()) return;
    const emp = EMPLOYEES.find(e => e.id === Number(newTask.assignee));
    setTasks([
      ...tasks,
      {
        id: Date.now(),
        title: newTask.title,
        assignee: Number(newTask.assignee),
        team: emp.team,
        priority: newTask.priority,
        status: 'لم تبدأ',
        due: newTask.due || 'لاحقاً',
      }
    ]);
    setNewTask({ title: '', assignee: 1, priority: 'متوسطة', due: '' });
    setShowNew(false);
  };

  const cycleStatus = (id) => {
    const order = ['لم تبدأ', 'قيد التنفيذ', 'مكتملة'];
    setTasks(tasks.map(t =>
      t.id === id
        ? { ...t, status: order[(order.indexOf(t.status) + 1) % order.length] }
        : t
    ));
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="TASKS · إدارة المهام"
        title="تقسيم ومتابعة المهام"
        action={
          <button
            onClick={() => setShowNew(!showNew)}
            className="flex items-center gap-2 bg-[#1a1d2e] text-[#fbf8f0] px-4 py-2.5 rounded-xl text-sm font-body hover:bg-[#2a2d3e] transition"
          >
            <Plus size={16}/>
            مهمة جديدة
          </button>
        }
      />

      {showNew && (
        <Card className="p-5 anim-slide">
          <div className="grid grid-cols-12 gap-3">
            <input
              placeholder="عنوان المهمة..."
              value={newTask.title}
              onChange={e => setNewTask({...newTask, title: e.target.value})}
              className="col-span-4 px-4 py-2.5 bg-[#fbf8f0] border border-[#e8e1cf] rounded-xl text-sm font-body focus:outline-none focus:border-[#1a1d2e]"
            />
            <select
              value={newTask.assignee}
              onChange={e => setNewTask({...newTask, assignee: e.target.value})}
              className="col-span-3 px-4 py-2.5 bg-[#fbf8f0] border border-[#e8e1cf] rounded-xl text-sm font-body focus:outline-none focus:border-[#1a1d2e]"
            >
              {EMPLOYEES.map(e => (
                <option key={e.id} value={e.id}>{e.name} · {TEAMS[e.team].name}</option>
              ))}
            </select>
            <select
              value={newTask.priority}
              onChange={e => setNewTask({...newTask, priority: e.target.value})}
              className="col-span-2 px-4 py-2.5 bg-[#fbf8f0] border border-[#e8e1cf] rounded-xl text-sm font-body focus:outline-none focus:border-[#1a1d2e]"
            >
              <option>عالية</option><option>متوسطة</option><option>منخفضة</option>
            </select>
            <input
              placeholder="موعد التسليم"
              value={newTask.due}
              onChange={e => setNewTask({...newTask, due: e.target.value})}
              className="col-span-2 px-4 py-2.5 bg-[#fbf8f0] border border-[#e8e1cf] rounded-xl text-sm font-body focus:outline-none focus:border-[#1a1d2e]"
            />
            <button
              onClick={addTask}
              className="col-span-1 bg-[#3d7a4f] text-white rounded-xl text-sm font-body hover:bg-[#2a5236] transition"
            >
              إضافة
            </button>
          </div>
        </Card>
      )}

      {/* Team filter chips */}
      <div className="flex items-center gap-2">
        <Filter size={14} className="text-[#857961]"/>
        <button
          onClick={() => setFilterTeam('all')}
          className={`px-3.5 py-1.5 rounded-full text-sm font-body transition ${
            filterTeam === 'all'
              ? 'bg-[#1a1d2e] text-[#fbf8f0]'
              : 'bg-transparent border border-[#e8e1cf] text-[#1a1d2e] hover:bg-[#fbf8f0]'
          }`}
        >
          كل الفرق
        </button>
        {Object.values(TEAMS).map(t => (
          <button
            key={t.id}
            onClick={() => setFilterTeam(t.id)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-body transition border ${
              filterTeam === t.id ? '' : 'hover:bg-[#fbf8f0]'
            }`}
            style={{
              background: filterTeam === t.id ? t.color : 'transparent',
              color: filterTeam === t.id ? '#fbf8f0' : t.color,
              borderColor: t.color,
            }}
          >
            {t.name}
          </button>
        ))}
      </div>

      {/* Tasks table */}
      <Card className="overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#e8e1cf] bg-[#f5f1e3]">
              {['المهمة', 'الموظف', 'الفريق', 'الأولوية', 'الحالة', 'التسليم', ''].map(h => (
                <th key={h} className="text-right px-5 py-3 text-xs uppercase tracking-wider text-[#857961] font-body font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((task, i) => {
              const emp = EMPLOYEES.find(e => e.id === task.assignee);
              const team = TEAMS[task.team];
              return (
                <tr key={task.id} className="border-b border-[#e8e1cf] last:border-0 hover:bg-[#f5f1e3]/50 transition anim-slide" style={{ animationDelay: `${i * 30}ms` }}>
                  <td className="px-5 py-4 font-body text-[#1a1d2e] text-sm">{task.title}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2.5">
                      <Avatar emp={emp} size={30}/>
                      <span className="font-body text-sm text-[#1a1d2e]">{emp.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span className="inline-flex items-center gap-1.5 text-xs font-body" style={{ color: team.color }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: team.color }}/>
                      {team.name}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className="font-body text-sm" style={{ color: PRIORITY_STYLES[task.priority] }}>
                      {task.priority}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <button onClick={() => cycleStatus(task.id)}>
                      <Pill status={task.status}>{task.status}</Pill>
                    </button>
                  </td>
                  <td className="px-5 py-4 text-sm text-[#857961] font-body">{task.due}</td>
                  <td className="px-5 py-4">
                    <button className="text-[#857961] hover:text-[#1a1d2e]">
                      <MoreHorizontal size={16}/>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
};

// ─── Leave requests (moderator) ──────────────────────────────
const ModeratorLeaves = ({ leaves, setLeaves }) => {
  const [tab, setTab] = useState('معلقة');

  const filtered = leaves.filter(l => l.status === tab);
  const counts = {
    'معلقة':   leaves.filter(l => l.status === 'معلقة').length,
    'مقبولة':  leaves.filter(l => l.status === 'مقبولة').length,
    'مرفوضة':  leaves.filter(l => l.status === 'مرفوضة').length,
  };

  const decide = (id, status) => {
    setLeaves(leaves.map(l => l.id === id ? { ...l, status } : l));
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="LEAVES · طلبات الإجازة"
        title="مراجعة طلبات الإجازات"
      />

      <div className="flex items-center gap-1 border-b border-[#e8e1cf]">
        {Object.entries(counts).map(([k, v]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-5 py-3 text-sm font-body relative transition ${
              tab === k ? 'text-[#1a1d2e]' : 'text-[#857961] hover:text-[#1a1d2e]'
            }`}
          >
            {k} <span className="text-xs">({v})</span>
            {tab === k && (
              <div className="absolute bottom-0 right-0 left-0 h-0.5 bg-[#1a1d2e]"/>
            )}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {filtered.length === 0 && (
          <div className="col-span-2 text-center py-16 text-[#857961] font-body">
            لا توجد طلبات في هذه الفئة
          </div>
        )}
        {filtered.map((leave, i) => {
          const emp = EMPLOYEES.find(e => e.id === leave.employee);
          const team = TEAMS[emp.team];
          return (
            <Card key={leave.id} className="p-5 anim-slide" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-start gap-3">
                  <Avatar emp={emp} size={44}/>
                  <div>
                    <div className="font-display text-base text-[#1a1d2e]">{emp.name}</div>
                    <div className="text-xs text-[#857961] font-body mt-0.5">
                      {emp.role} · {team.name}
                    </div>
                  </div>
                </div>
                <Pill status={leave.status}>{leave.status}</Pill>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4 p-3 bg-[#f5f1e3] rounded-xl">
                <div>
                  <div className="text-xs text-[#857961] font-body mb-1">نوع الإجازة</div>
                  <div className="font-body text-sm text-[#1a1d2e]">{leave.type}</div>
                </div>
                <div>
                  <div className="text-xs text-[#857961] font-body mb-1">المدة</div>
                  <div className="font-body text-sm text-[#1a1d2e]">{leave.days} أيام</div>
                </div>
                <div>
                  <div className="text-xs text-[#857961] font-body mb-1">من</div>
                  <div className="font-body text-sm text-[#1a1d2e]">{leave.from}</div>
                </div>
                <div>
                  <div className="text-xs text-[#857961] font-body mb-1">إلى</div>
                  <div className="font-body text-sm text-[#1a1d2e]">{leave.to}</div>
                </div>
              </div>

              <div className="text-xs text-[#857961] font-body mb-1">السبب</div>
              <div className="font-body text-sm text-[#1a1d2e] mb-4">{leave.reason}</div>

              {leave.status === 'معلقة' && (
                <div className="flex gap-2 pt-3 border-t border-[#e8e1cf]">
                  <button
                    onClick={() => decide(leave.id, 'مقبولة')}
                    className="flex-1 flex items-center justify-center gap-2 bg-[#3d7a4f] text-white py-2.5 rounded-xl text-sm font-body hover:bg-[#2a5236] transition"
                  >
                    <Check size={15}/> قبول
                  </button>
                  <button
                    onClick={() => decide(leave.id, 'مرفوضة')}
                    className="flex-1 flex items-center justify-center gap-2 bg-transparent border border-[#8b3a4e] text-[#8b3a4e] py-2.5 rounded-xl text-sm font-body hover:bg-[#ecd9de] transition"
                  >
                    <X size={15}/> رفض
                  </button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
};

// ─── Teams (moderator) ──────────────────────────────────────
const ModeratorTeams = ({ tasks }) => {
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="TEAMS · الفرق"
        title="فرق العمل وأعضاؤها"
      />

      <div className="grid grid-cols-3 gap-4">
        {Object.values(TEAMS).map((team, ti) => {
          const Icon = team.icon;
          const members = EMPLOYEES.filter(e => e.team === team.id);
          const teamTasks = tasks.filter(t => t.team === team.id);
          const done = teamTasks.filter(t => t.status === 'مكتملة').length;
          return (
            <Card key={team.id} className="overflow-hidden anim-slide" style={{ animationDelay: `${ti * 100}ms` }}>
              <div className="p-5 border-b border-[#e8e1cf]" style={{ background: team.soft }}>
                <div className="flex items-center justify-between mb-3">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center"
                    style={{ background: team.color, color: team.soft }}
                  >
                    <Icon size={20}/>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-2xl font-semibold" style={{ color: team.color }}>
                      {members.length}
                    </div>
                    <div className="text-xs font-body" style={{ color: team.color }}>أعضاء</div>
                  </div>
                </div>
                <div className="font-display text-xl" style={{ color: team.color }}>{team.name}</div>
                <div className="text-xs font-body mt-1" style={{ color: team.color, opacity: 0.7 }}>
                  {done}/{teamTasks.length} مهمة مكتملة
                </div>
              </div>
              <div className="p-3 space-y-1">
                {members.map(m => (
                  <div key={m.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-[#f5f1e3] transition">
                    <Avatar emp={m} size={34}/>
                    <div className="flex-1 min-w-0">
                      <div className="font-body text-sm text-[#1a1d2e] truncate">{m.name}</div>
                      <div className="text-xs text-[#857961] font-body truncate">{m.role}</div>
                    </div>
                    <div className="text-xs font-display font-semibold" style={{ color: team.color }}>
                      {m.score}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// EMPLOYEE VIEWS  (currently logged in: employee #1, Mohamed Ahmed)
// ─────────────────────────────────────────────────────────────
const CURRENT_EMPLOYEE_ID = 1;

const EmployeeOverview = ({ tasks, leaves }) => {
  const me = EMPLOYEES.find(e => e.id === CURRENT_EMPLOYEE_ID);
  const myTasks = tasks.filter(t => t.assignee === CURRENT_EMPLOYEE_ID);
  const myLeaves = leaves.filter(l => l.employee === CURRENT_EMPLOYEE_ID);
  const team = TEAMS[me.team];

  const inProgress = myTasks.filter(t => t.status === 'قيد التنفيذ').length;
  const completed = myTasks.filter(t => t.status === 'مكتملة').length;

  return (
    <div className="space-y-8">
      {/* hero */}
      <Card className="relative overflow-hidden p-8" style={{ background: 'linear-gradient(135deg, #1a1d2e 0%, #2a2d3e 100%)' }}>
        <div className="absolute top-0 right-0 w-72 h-72 rounded-full opacity-10" style={{ background: team.color, transform: 'translate(40%, -40%)' }}/>
        <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full opacity-5" style={{ background: '#f5f1e3', transform: 'translate(-30%, 30%)' }}/>
        <div className="relative">
          <div className="text-xs uppercase tracking-[0.25em] text-[#a86b2c] font-latin-serif mb-3">
            WELCOME BACK
          </div>
          <h1 className="font-display text-4xl text-[#fbf8f0] mb-2">أهلاً، {me.name}</h1>
          <div className="text-[#a8a3a3] font-body text-sm">
            {me.role} · فريق {team.name}
          </div>
          <div className="flex items-center gap-6 mt-6">
            <div>
              <div className="text-3xl font-display font-semibold text-[#fbf8f0]">{me.score}</div>
              <div className="text-xs text-[#a8a3a3] font-body mt-1">معدّل الأداء</div>
            </div>
            <div className="w-px h-12 bg-[#fbf8f0]/20"/>
            <div>
              <div className="text-3xl font-display font-semibold text-[#fbf8f0]">{myTasks.length}</div>
              <div className="text-xs text-[#a8a3a3] font-body mt-1">مهمة هذا الشهر</div>
            </div>
            <div className="w-px h-12 bg-[#fbf8f0]/20"/>
            <div>
              <div className="text-3xl font-display font-semibold text-[#fbf8f0]">{completed}</div>
              <div className="text-xs text-[#a8a3a3] font-body mt-1">مهمة مكتملة</div>
            </div>
          </div>
        </div>
      </Card>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="flex items-center gap-2 text-xs text-[#857961] font-body mb-2">
            <Clock size={13}/> مهام جارية
          </div>
          <div className="font-display text-3xl text-[#1a1d2e]">{inProgress}</div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-xs text-[#857961] font-body mb-2">
            <CalendarDays size={13}/> طلبات إجازة هذا العام
          </div>
          <div className="font-display text-3xl text-[#1a1d2e]">{myLeaves.length}</div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-xs text-[#857961] font-body mb-2">
            <Award size={13}/> ترتيبك في الفريق
          </div>
          <div className="font-display text-3xl text-[#1a1d2e]">
            ٢<span className="text-base text-[#857961]">/4</span>
          </div>
        </Card>
      </div>

      {/* My current tasks */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-xl text-[#1a1d2e]">مهامي الحالية</h3>
          <span className="text-xs text-[#857961] font-body">{myTasks.length} مهمة</span>
        </div>
        <div className="space-y-2">
          {myTasks.map((t, i) => (
            <Card key={t.id} className="p-4 flex items-center gap-4 anim-slide" style={{ animationDelay: `${i * 50}ms` }}>
              <div className="w-1 h-10 rounded-full" style={{ background: PRIORITY_STYLES[t.priority] }}/>
              <div className="flex-1">
                <div className="font-body text-[#1a1d2e]">{t.title}</div>
                <div className="text-xs text-[#857961] font-body mt-1">التسليم: {t.due}</div>
              </div>
              <Pill status={t.status}>{t.status}</Pill>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

const EmployeeLeave = ({ leaves, setLeaves }) => {
  const myLeaves = leaves.filter(l => l.employee === CURRENT_EMPLOYEE_ID);
  const [form, setForm] = useState({ type: 'إجازة اعتيادية', from: '', to: '', days: 1, reason: '' });

  const submit = () => {
    if (!form.from || !form.to || !form.reason) return;
    setLeaves([
      ...leaves,
      {
        id: Date.now(),
        employee: CURRENT_EMPLOYEE_ID,
        ...form,
        status: 'معلقة'
      }
    ]);
    setForm({ type: 'إجازة اعتيادية', from: '', to: '', days: 1, reason: '' });
  };

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="MY LEAVES · إجازاتي"
        title="تقديم طلب إجازة"
      />

      <div className="grid grid-cols-5 gap-6">
        {/* Form */}
        <Card className="p-6 col-span-3">
          <div className="font-display text-lg text-[#1a1d2e] mb-5">طلب إجازة جديد</div>

          <div className="space-y-4">
            <div>
              <label className="text-xs text-[#857961] font-body mb-1.5 block">نوع الإجازة</label>
              <select
                value={form.type}
                onChange={e => setForm({...form, type: e.target.value})}
                className="w-full px-4 py-2.5 bg-[#fbf8f0] border border-[#e8e1cf] rounded-xl text-sm font-body focus:outline-none focus:border-[#1a1d2e]"
              >
                <option>إجازة اعتيادية</option>
                <option>إجازة مرضية</option>
                <option>إجازة طارئة</option>
                <option>إجازة بدون مرتب</option>
              </select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-[#857961] font-body mb-1.5 block">من تاريخ</label>
                <input
                  type="text"
                  placeholder="٣ يونيو"
                  value={form.from}
                  onChange={e => setForm({...form, from: e.target.value})}
                  className="w-full px-4 py-2.5 bg-[#fbf8f0] border border-[#e8e1cf] rounded-xl text-sm font-body focus:outline-none focus:border-[#1a1d2e]"
                />
              </div>
              <div>
                <label className="text-xs text-[#857961] font-body mb-1.5 block">إلى تاريخ</label>
                <input
                  type="text"
                  placeholder="٥ يونيو"
                  value={form.to}
                  onChange={e => setForm({...form, to: e.target.value})}
                  className="w-full px-4 py-2.5 bg-[#fbf8f0] border border-[#e8e1cf] rounded-xl text-sm font-body focus:outline-none focus:border-[#1a1d2e]"
                />
              </div>
              <div>
                <label className="text-xs text-[#857961] font-body mb-1.5 block">عدد الأيام</label>
                <input
                  type="number"
                  min={1}
                  value={form.days}
                  onChange={e => setForm({...form, days: Number(e.target.value)})}
                  className="w-full px-4 py-2.5 bg-[#fbf8f0] border border-[#e8e1cf] rounded-xl text-sm font-body focus:outline-none focus:border-[#1a1d2e]"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-[#857961] font-body mb-1.5 block">السبب</label>
              <textarea
                rows={3}
                placeholder="اذكر سبب طلب الإجازة..."
                value={form.reason}
                onChange={e => setForm({...form, reason: e.target.value})}
                className="w-full px-4 py-2.5 bg-[#fbf8f0] border border-[#e8e1cf] rounded-xl text-sm font-body focus:outline-none focus:border-[#1a1d2e] resize-none"
              />
            </div>

            <button
              onClick={submit}
              className="w-full bg-[#1a1d2e] text-[#fbf8f0] py-3 rounded-xl text-sm font-body hover:bg-[#2a2d3e] transition flex items-center justify-center gap-2"
            >
              <Sparkles size={15}/>
              تقديم الطلب
            </button>
          </div>
        </Card>

        {/* History */}
        <Card className="p-6 col-span-2">
          <div className="font-display text-lg text-[#1a1d2e] mb-5">سجل طلباتي</div>
          <div className="space-y-3">
            {myLeaves.length === 0 && (
              <div className="text-center py-8 text-[#857961] font-body text-sm">
                لا توجد طلبات سابقة
              </div>
            )}
            {myLeaves.map(l => (
              <div key={l.id} className="p-3 bg-[#f5f1e3] rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-body text-sm text-[#1a1d2e]">{l.type}</span>
                  <Pill status={l.status}>{l.status}</Pill>
                </div>
                <div className="text-xs text-[#857961] font-body">
                  {l.from} → {l.to} · {l.days} أيام
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};

const EmployeePerformance = () => {
  const me = EMPLOYEES.find(e => e.id === CURRENT_EMPLOYEE_ID);
  const team = TEAMS[me.team];

  const metrics = [
    { label: 'الالتزام بالمواعيد', value: 94, color: '#3d7a4f' },
    { label: 'جودة العمل',          value: 88, color: '#a86b2c' },
    { label: 'التعاون مع الفريق',  value: 95, color: '#2d5d6e' },
    { label: 'المبادرة',            value: 82, color: '#8b3a4e' },
  ];

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="PRIVATE · تقييم خاص بك"
        title="أداؤك وتقييمك"
        action={
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#dce8df] rounded-full">
            <div className="w-1.5 h-1.5 rounded-full bg-[#3d7a4f] animate-pulse"/>
            <span className="text-xs text-[#2a5236] font-body">هذه الصفحة مرئية لك فقط</span>
          </div>
        }
      />

      <div className="grid grid-cols-3 gap-4">
        {/* Overall score */}
        <Card className="p-6 relative overflow-hidden">
          <div className="text-xs uppercase tracking-[0.2em] text-[#857961] font-latin-serif mb-1">OVERALL SCORE</div>
          <div className="font-display text-base text-[#1a1d2e] mb-4">المعدّل العام</div>
          <ResponsiveContainer width="100%" height={170}>
            <RadialBarChart
              innerRadius="65%"
              outerRadius="100%"
              data={[{ name: 'score', value: me.score, fill: team.color }]}
              startAngle={90}
              endAngle={-270}
            >
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false}/>
              <RadialBar dataKey="value" cornerRadius={20} background={{ fill: '#e8e1cf' }}/>
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="absolute inset-x-0 top-[58%] text-center">
            <div className="font-display text-5xl font-semibold" style={{ color: team.color }}>{me.score}</div>
            <div className="text-xs text-[#857961] font-body mt-0.5">من 100</div>
          </div>
        </Card>

        {/* Weekly */}
        <Card className="p-6 col-span-2">
          <div className="text-xs uppercase tracking-[0.2em] text-[#857961] font-latin-serif mb-1">THIS WEEK</div>
          <div className="font-display text-base text-[#1a1d2e] mb-4">أداؤك هذا الأسبوع</div>
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={PERF_WEEKLY}>
              <CartesianGrid strokeDasharray="2 4" stroke="#e8e1cf" vertical={false}/>
              <XAxis dataKey="d" stroke="#857961" fontSize={11} tickLine={false} axisLine={false} reversed/>
              <YAxis stroke="#857961" fontSize={11} tickLine={false} axisLine={false} orientation="right" domain={[60, 100]}/>
              <Tooltip
                contentStyle={{
                  background: '#fbf8f0', border: '1px solid #e8e1cf',
                  borderRadius: 12, fontFamily: 'IBM Plex Sans Arabic'
                }}
              />
              <Line
                type="monotone"
                dataKey="val"
                stroke={team.color}
                strokeWidth={2.5}
                dot={{ fill: team.color, r: 4 }}
                activeDot={{ r: 6 }}
                name="النقاط"
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Detailed metrics */}
      <Card className="p-6">
        <div className="font-display text-lg text-[#1a1d2e] mb-5">تفصيل التقييم</div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
          {metrics.map((m, i) => (
            <div key={i} className="anim-slide" style={{ animationDelay: `${i * 80}ms` }}>
              <div className="flex items-baseline justify-between mb-2">
                <span className="font-body text-sm text-[#1a1d2e]">{m.label}</span>
                <span className="font-display text-xl font-semibold" style={{ color: m.color }}>
                  {m.value}<span className="text-sm text-[#857961]">/100</span>
                </span>
              </div>
              <div className="h-1.5 bg-[#e8e1cf] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{ width: `${m.value}%`, background: m.color }}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Feedback from manager */}
      <Card className="p-6 bg-[#f5f1e3]/60">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-[#1a1d2e] text-[#fbf8f0] flex items-center justify-center font-display">
            م
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-body text-sm text-[#1a1d2e] font-medium">المدير المباشر</span>
              <span className="text-xs text-[#857961] font-body">· قبل يومين</span>
            </div>
            <div className="font-body text-sm text-[#3d3d3d] leading-relaxed">
              أداء ممتاز هذا الشهر، ملاحظتي البسيطة هي الاهتمام بسرعة الاستجابة في تذاكر الدعم العاجلة.
              استمر بهذا المستوى وركّز على تنمية مهارات المبادرة.
            </div>
            <div className="flex items-center gap-1 mt-3">
              {[1,2,3,4,5].map(s => (
                <Star key={s} size={14} className={s <= 4 ? 'fill-[#a86b2c] text-[#a86b2c]' : 'text-[#e8e1cf]'}/>
              ))}
              <span className="text-xs text-[#857961] font-body mr-1">4.0 / 5.0</span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// SIDEBAR STRUCTURE  — الهيكل الرئيسي للتنقل
// كل قسم: { id, labelAr, labelEn, icon, items }
// كل عنصر: { id, labelAr, labelEn, children?, soon? }
// soon: ميزة مؤجلة (لاحقًا) — تظهر بشارة «قريباً»
// ─────────────────────────────────────────────────────────────
const SIDEBAR_SECTIONS = [
  {
    id: 'customer-care', labelAr: 'خدمة العملاء', labelEn: 'Customer Care', icon: Headphones,
    items: [
      { id: 'cc-shift-dashboard',  labelAr: 'لوحة الوردية',         labelEn: 'Shift Dashboard' },
      { id: 'cc-interactions',     labelAr: 'تفاعلات العملاء',      labelEn: 'Customer Interactions' },
      { id: 'cc-inbound-calls',    labelAr: 'المكالمات الواردة',    labelEn: 'Inbound Calls' },
      { id: 'cc-outbound-calls',   labelAr: 'المكالمات الصادرة',    labelEn: 'Outbound Calls' },
      { id: 'cc-tickets',          labelAr: 'التذاكر',              labelEn: 'Tickets' },
      { id: 'cc-complaints',       labelAr: 'الشكاوى',              labelEn: 'Complaints' },
      { id: 'cc-order-followup',   labelAr: 'متابعة الطلبات',       labelEn: 'Order Follow-up' },
      { id: 'cc-availability',     labelAr: 'فحص التوفر',           labelEn: 'Availability Checks' },
      { id: 'cc-customer-history', labelAr: 'سجل العميل',           labelEn: 'Customer History' },
      { id: 'cc-csat',             labelAr: 'رضا العملاء (CSAT)',   labelEn: 'CSAT' },
      { id: 'cc-agent-productivity', labelAr: 'إنتاجية الموظفين',   labelEn: 'Agent Productivity' },
    ],
  },
  {
    id: 'crm', labelAr: 'إدارة العملاء (CRM)', labelEn: 'CRM', icon: UserPlus,
    items: [
      { id: 'crm-leads',             labelAr: 'العملاء المحتملون',      labelEn: 'Leads' },
      { id: 'crm-lead-upload',       labelAr: 'رفع الـ Leads',          labelEn: 'Lead Upload' },
      { id: 'crm-lead-distribution', labelAr: 'توزيع الـ Leads',        labelEn: 'Lead Distribution' },
      { id: 'crm-shift-sessions',    labelAr: 'جلسات الورديات',         labelEn: 'Shift Sessions' },
      { id: 'crm-called-leads',      labelAr: 'Leads تم الاتصال بها',   labelEn: 'Called Leads' },
      { id: 'crm-followups',         labelAr: 'المتابعات',              labelEn: 'Follow-ups' },
      { id: 'crm-call-reschedule',   labelAr: 'إعادة جدولة المكالمات',  labelEn: 'Call Reschedule' },
      { id: 'crm-refill-reminder',   labelAr: 'تذكير إعادة الصرف',      labelEn: 'Refill Reminder' },
      { id: 'crm-customer-profile',  labelAr: 'ملف العميل',             labelEn: 'Customer Profile' },
      { id: 'crm-segments',          labelAr: 'شرائح العملاء',          labelEn: 'Customer Segments' },
      { id: 'crm-retention',         labelAr: 'الاحتفاظ بالعملاء',      labelEn: 'Retention' },
      { id: 'crm-opportunities',     labelAr: 'فرص البيع',              labelEn: 'Sales Opportunities' },
      { id: 'crm-conversion-rate',   labelAr: 'معدل التحويل',           labelEn: 'Conversion Rate' },
      { id: 'crm-telesales-orders',  labelAr: 'طلبات التيلي سيلز',      labelEn: 'Telesales Orders' },
      { id: 'crm-insurance-partners', labelAr: 'شركاء التأمين',         labelEn: 'Insurance Partners' },
    ],
  },
  {
    id: 'knowledge-base', labelAr: 'قاعدة المعرفة', labelEn: 'Knowledge Base', icon: BookOpen,
    items: [
      { id: 'kb-articles',        labelAr: 'المقالات',                    labelEn: 'Articles' },
      { id: 'kb-policies',        labelAr: 'السياسات',                    labelEn: 'Policies' },
      { id: 'kb-faqs',            labelAr: 'الأسئلة الشائعة',             labelEn: 'FAQs' },
      { id: 'kb-scripts',         labelAr: 'نصوص المكالمات',              labelEn: 'Scripts' },
      { id: 'kb-call-guidelines', labelAr: 'إرشادات التعامل مع المكالمات', labelEn: 'Call Handling Guidelines' },
      { id: 'kb-product',         labelAr: 'معرفة المنتجات',              labelEn: 'Product Knowledge' },
      { id: 'kb-insurance',       labelAr: 'إرشادات التأمين',             labelEn: 'Insurance Guidelines' },
      { id: 'kb-wasfaty',         labelAr: 'إرشادات وصفتي',               labelEn: 'Wasfaty Guidelines' },
      { id: 'kb-training',        labelAr: 'مواد التدريب',                labelEn: 'Training Materials' },
      { id: 'kb-announcements',   labelAr: 'الإعلانات',                   labelEn: 'Announcements' },
      { id: 'kb-versions',        labelAr: 'سجل الإصدارات',               labelEn: 'Version History' },
      { id: 'kb-approval',        labelAr: 'سير الموافقات',               labelEn: 'Approval Workflow' },
    ],
  },
  {
    id: 'branches', labelAr: 'مركز الفروع', labelEn: 'Branches Center', icon: Building2,
    items: [
      { id: 'br-database',    labelAr: 'قاعدة بيانات الفروع', labelEn: 'Branches Database' },
      { id: 'br-details',     labelAr: 'تفاصيل الفرع',        labelEn: 'Branch Details' },
      { id: 'br-hours',       labelAr: 'ساعات عمل الفروع',    labelEn: 'Branch Working Hours' },
      { id: 'br-contacts',    labelAr: 'جهات اتصال الفروع',   labelEn: 'Branch Contacts' },
      { id: 'br-supervisors', labelAr: 'المشرفون',            labelEn: 'Supervisors' },
      { id: 'br-structure',   labelAr: 'هيكل الفرع',          labelEn: 'Branch Structure' },
      { id: 'br-services',    labelAr: 'الخدمات المتاحة',     labelEn: 'Available Services' },
      { id: 'br-tickets',     labelAr: 'تذاكر الفروع',        labelEn: 'Branch Tickets' },
      { id: 'br-complaints',  labelAr: 'شكاوى الفروع',        labelEn: 'Branch Complaints' },
      { id: 'br-escalations', labelAr: 'تصعيدات الفروع',      labelEn: 'Branch Escalations' },
      { id: 'br-documents',   labelAr: 'مستندات الفروع',      labelEn: 'Branch Documents' },
      { id: 'br-stock',       labelAr: 'ربط مخزون الفروع',    labelEn: 'Branch Stock Integration', soon: true },
    ],
  },
  {
    id: 'dic', labelAr: 'United Pharmacy DIC', labelEn: 'United Pharmacy DIC',
    subtitle: 'Drug Information Center', icon: PillIcon,
    items: [
      { id: 'dic-drugs-db',        labelAr: 'قاعدة بيانات الأدوية',   labelEn: 'Drugs Database' },
      { id: 'dic-trade-search',    labelAr: 'البحث بالاسم التجاري',   labelEn: 'Trade Name Search' },
      { id: 'dic-scientific-search', labelAr: 'البحث بالاسم العلمي',  labelEn: 'Scientific Name Search' },
      { id: 'dic-ingredients',     labelAr: 'المواد الفعالة',         labelEn: 'Active Ingredients' },
      { id: 'dic-alternatives',    labelAr: 'البدائل',                labelEn: 'Alternatives' },
      {
        id: 'dic-classification',  labelAr: 'تصنيف الأدوية',          labelEn: 'Drug Classification',
        children: [
          { id: 'dic-class-normal',  labelAr: 'عادي',  labelEn: 'Normal' },
          { id: 'dic-class-special', labelAr: 'خاص',   labelEn: 'Special' },
          { id: 'dic-class-raqeeb',  labelAr: 'رقيب',  labelEn: 'Raqeeb' },
        ],
      },
      { id: 'dic-insurance-coverage', labelAr: 'التغطية التأمينية',   labelEn: 'Insurance Coverage' },
      { id: 'dic-meena-coverage',  labelAr: 'تغطية مشروع مينا',       labelEn: 'Project Meena Coverage' },
      { id: 'dic-wasfaty-coverage', labelAr: 'تغطية وصفتي',           labelEn: 'Wasfaty Coverage' },
      { id: 'dic-interactions',    labelAr: 'التداخلات الدوائية',     labelEn: 'Drug Interactions' },
      { id: 'dic-info-requests',   labelAr: 'طلبات المعلومات الدوائية', labelEn: 'Drug Information Requests' },
      { id: 'dic-availability',    labelAr: 'توفر المنتجات',          labelEn: 'Product Availability' },
      { id: 'dic-tickets',         labelAr: 'تذاكر DIC',              labelEn: 'DIC Tickets' },
      { id: 'dic-references',      labelAr: 'المراجع الطبية',         labelEn: 'Medical References' },
    ],
  },
  {
    id: 'delivery', labelAr: 'التوصيل واللوجستيات', labelEn: 'Delivery & Logistics', icon: Truck,
    items: [
      { id: 'dl-orders',      labelAr: 'طلبات التوصيل', labelEn: 'Delivery Orders' },
      {
        id: 'dl-status',      labelAr: 'حالة التوصيل',  labelEn: 'Delivery Status',
        children: [
          { id: 'dl-status-ready',     labelAr: 'جاهز للاستلام',  labelEn: 'Ready for Pickup' },
          { id: 'dl-status-picked',    labelAr: 'تم الاستلام',    labelEn: 'Picked Up' },
          { id: 'dl-status-on-way',    labelAr: 'في الطريق',      labelEn: 'On the Way' },
          { id: 'dl-status-delivered', labelAr: 'تم التوصيل',     labelEn: 'Delivered' },
          { id: 'dl-status-failed',    labelAr: 'توصيل فاشل',     labelEn: 'Failed Delivery' },
          { id: 'dl-status-holded',    labelAr: 'معلّق',          labelEn: 'Holded' },
        ],
      },
      { id: 'dl-time-slots',  labelAr: 'فترات التوصيل',      labelEn: 'Delivery Time Slots' },
      { id: 'dl-cities',      labelAr: 'المدن',              labelEn: 'Cities' },
      { id: 'dl-districts',   labelAr: 'الأحياء',            labelEn: 'Districts' },
      { id: 'dl-store-pickup', labelAr: 'الاستلام من الفرع', labelEn: 'Store Pickup' },
      { id: 'dl-exceptions',  labelAr: 'استثناءات التوصيل',  labelEn: 'Delivery Exceptions' },
      { id: 'dl-courier-perf', labelAr: 'أداء المناديب',     labelEn: 'Courier Performance' },
      { id: 'dl-escalations', labelAr: 'تصعيدات لوجستية',    labelEn: 'Logistics Escalations' },
    ],
  },
  {
    id: 'reporting', labelAr: 'التقارير', labelEn: 'Reporting', icon: BarChart3,
    items: [
      { id: 'rp-customer-care', labelAr: 'تقارير خدمة العملاء',   labelEn: 'Customer Care Reports' },
      { id: 'rp-telesales',     labelAr: 'تقارير التيلي سيلز',    labelEn: 'Telesales Reports' },
      { id: 'rp-operations',    labelAr: 'تقارير العمليات',       labelEn: 'Operations Reports' },
      { id: 'rp-tickets',       labelAr: 'تقارير التذاكر',        labelEn: 'Ticket Reports' },
      { id: 'rp-calls',         labelAr: 'تقارير المكالمات',      labelEn: 'Calls Reports' },
      { id: 'rp-orders',        labelAr: 'تقارير الطلبات',        labelEn: 'Order Reports' },
      { id: 'rp-leads',         labelAr: 'تقارير الـ Leads',      labelEn: 'Lead Reports' },
      { id: 'rp-branches',      labelAr: 'تقارير الفروع',         labelEn: 'Branch Reports' },
      { id: 'rp-delivery',      labelAr: 'تقارير التوصيل',        labelEn: 'Delivery Reports' },
      { id: 'rp-csat',          labelAr: 'تقارير رضا العملاء',    labelEn: 'CSAT Reports' },
      { id: 'rp-partners',      labelAr: 'تقارير الشركاء',        labelEn: 'Partner Reports' },
      { id: 'rp-builder',       labelAr: 'منشئ التقارير المخصصة', labelEn: 'Custom Report Builder' },
      { id: 'rp-export',        labelAr: 'تصدير Excel / PDF',     labelEn: 'Export Excel / PDF' },
    ],
  },
  {
    id: 'performance', labelAr: 'الأداء ومؤشرات القياس', labelEn: 'Performance & KPIs', icon: Gauge,
    items: [
      { id: 'pf-agent-kpis',     labelAr: 'مؤشرات الموظف',          labelEn: 'Agent KPIs' },
      { id: 'pf-team-kpis',      labelAr: 'مؤشرات الفريق',          labelEn: 'Team KPIs' },
      { id: 'pf-monthly-targets', labelAr: 'الأهداف الشهرية',       labelEn: 'Monthly Targets' },
      { id: 'pf-annual-targets', labelAr: 'الأهداف السنوية',        labelEn: 'Annual Targets' },
      { id: 'pf-conversion',     labelAr: 'معدل التحويل',           labelEn: 'Conversion Rate' },
      { id: 'pf-aht',            labelAr: 'متوسط وقت المكالمة (AHT)', labelEn: 'AHT' },
      { id: 'pf-talking-time',   labelAr: 'إجمالي وقت التحدث',      labelEn: 'Total Talking Time' },
      { id: 'pf-attendance',     labelAr: 'أداء الحضور',            labelEn: 'Attendance Performance' },
      { id: 'pf-call-quality',   labelAr: 'جودة المكالمات',         labelEn: 'Call Quality' },
      { id: 'pf-orders-completed', labelAr: 'الطلبات المكتملة',     labelEn: 'Orders Completed' },
      { id: 'pf-orders-closed',  labelAr: 'الطلبات المغلقة',        labelEn: 'Orders Closed' },
      { id: 'pf-lead-productivity', labelAr: 'إنتاجية الـ Leads',   labelEn: 'Lead Productivity' },
      { id: 'pf-ticket-resolution', labelAr: 'وقت حل التذاكر',      labelEn: 'Ticket Resolution Time' },
      { id: 'pf-sla',            labelAr: 'أداء اتفاقيات SLA',      labelEn: 'SLA Performance' },
      { id: 'pf-csat-score',     labelAr: 'درجة رضا العملاء',       labelEn: 'CSAT Score' },
      { id: 'pf-ranking',        labelAr: 'الترتيب',                labelEn: 'Ranking' },
      { id: 'pf-achievement',    labelAr: 'نسبة الإنجاز',           labelEn: 'Achievement Percentage' },
    ],
  },
  {
    id: 'hr', labelAr: 'الطلبات الإدارية', labelEn: 'HR Request', icon: FileText,
    items: [
      { id: 'hr-vacation',    labelAr: 'طلب إجازة',          labelEn: 'Vacation Request' },
      { id: 'hr-permission',  labelAr: 'طلب استئذان',        labelEn: 'Permission Request' },
      { id: 'hr-shift-change', labelAr: 'تغيير الوردية',     labelEn: 'Shift Change' },
      { id: 'hr-overtime',    labelAr: 'طلب عمل إضافي',      labelEn: 'Overtime Request' },
      { id: 'hr-attendance',  labelAr: 'تصحيح الحضور',       labelEn: 'Attendance Correction' },
      { id: 'hr-wfh',         labelAr: 'طلب عمل من المنزل',  labelEn: 'Work From Home Request' },
      { id: 'hr-equipment',   labelAr: 'طلب معدات',          labelEn: 'Equipment Request' },
      { id: 'hr-salary-cert', labelAr: 'شهادة راتب',         labelEn: 'Salary Certificate' },
      { id: 'hr-letter',      labelAr: 'خطاب تعريف',         labelEn: 'Employee Letter' },
      { id: 'hr-resignation', labelAr: 'طلب استقالة',        labelEn: 'Resignation Request' },
      { id: 'hr-grievance',   labelAr: 'شكوى / تظلم',        labelEn: 'Complaint / Grievance' },
      { id: 'hr-other',       labelAr: 'طلبات أخرى',         labelEn: 'Other Requests' },
      { id: 'hr-approval-flow', labelAr: 'مسار الموافقات',   labelEn: 'Request Approval Flow' },
    ],
  },
  {
    id: 'team-mgmt', labelAr: 'إدارة الفرق', labelEn: 'Team Management', icon: Users,
    items: [
      { id: 'tm-teams',           labelAr: 'الفرق',                  labelEn: 'Teams' },
      { id: 'tm-employees',       labelAr: 'الموظفون',               labelEn: 'Employees' },
      { id: 'tm-roles',           labelAr: 'الأدوار',                labelEn: 'Roles' },
      { id: 'tm-supervisors',     labelAr: 'المشرفون',               labelEn: 'Supervisors' },
      { id: 'tm-team-leaders',    labelAr: 'قادة الفرق',             labelEn: 'Team Leaders' },
      { id: 'tm-shift-supervisors', labelAr: 'مشرفو الورديات',       labelEn: 'Shift Supervisors' },
      { id: 'tm-agents',          labelAr: 'الأخصائيون (Agents)',    labelEn: 'Agents' },
      { id: 'tm-shift-scheduling', labelAr: 'جدولة الورديات',        labelEn: 'Shift Scheduling' },
      { id: 'tm-shift-sessions',  labelAr: 'جلسات الورديات',         labelEn: 'Shift Sessions' },
      { id: 'tm-agent-categories', labelAr: 'فئات الموظفين',         labelEn: 'Agent Categories' },
      { id: 'tm-skills',          labelAr: 'المهارات',               labelEn: 'Skills' },
      { id: 'tm-task-assignment', labelAr: 'إسناد المهام',           labelEn: 'Task Assignment' },
      { id: 'tm-workload',        labelAr: 'توزيع عبء العمل',        labelEn: 'Workload Distribution' },
      { id: 'tm-hierarchy',       labelAr: 'الهيكل التنظيمي للفريق', labelEn: 'Team Hierarchy' },
      { id: 'tm-performance-assign', labelAr: 'إسناد الأداء',        labelEn: 'Performance Assignment' },
      { id: 'tm-branch-assign',   labelAr: 'إسناد الفروع',           labelEn: 'Branch Assignment' },
      { id: 'tm-partner-assign',  labelAr: 'إسناد الشركاء',          labelEn: 'Partner Assignment' },
    ],
  },
  {
    id: 'settings', labelAr: 'الإعدادات', labelEn: 'Settings', icon: Settings,
    items: [
      {
        id: 'st-general', labelAr: 'الإعدادات العامة', labelEn: 'General Settings',
        children: [
          { id: 'st-gen-company',   labelAr: 'معلومات الشركة',   labelEn: 'Company Information' },
          { id: 'st-gen-logo',      labelAr: 'الشعار',           labelEn: 'Logo' },
          { id: 'st-gen-platform',  labelAr: 'اسم المنصة',       labelEn: 'Platform Name' },
          { id: 'st-gen-languages', labelAr: 'اللغات',           labelEn: 'Languages' },
          { id: 'st-gen-timezone',  labelAr: 'المنطقة الزمنية',  labelEn: 'Timezone' },
          { id: 'st-gen-date',      labelAr: 'تنسيق التاريخ',    labelEn: 'Date Format' },
        ],
      },
      {
        id: 'st-partner', labelAr: 'إعدادات الشركاء', labelEn: 'Partner Settings',
        children: [
          { id: 'st-pt-branding',  labelAr: 'هوية الشريك',        labelEn: 'Partner Branding' },
          { id: 'st-pt-logo',      labelAr: 'شعار الشريك',        labelEn: 'Partner Logo' },
          { id: 'st-pt-colors',    labelAr: 'ألوان الشريك',       labelEn: 'Partner Colors' },
          { id: 'st-pt-sms',       labelAr: 'قوالب SMS',          labelEn: 'SMS Templates' },
          { id: 'st-pt-email',     labelAr: 'قوالب البريد',       labelEn: 'Email Templates' },
          { id: 'st-pt-complaint', labelAr: 'تنسيق رقم الشكوى',   labelEn: 'Complaint Number Format' },
          { id: 'st-pt-csat',      labelAr: 'إعدادات CSAT',       labelEn: 'CSAT Settings' },
        ],
      },
      {
        id: 'st-communication', labelAr: 'إعدادات الاتصالات', labelEn: 'Communication Settings',
        children: [
          { id: 'st-cm-sms',      labelAr: 'مزود SMS',          labelEn: 'SMS Provider' },
          { id: 'st-cm-email',    labelAr: 'مزود البريد',       labelEn: 'Email Provider' },
          { id: 'st-cm-yeastar',  labelAr: 'Yeastar',           labelEn: 'Yeastar' },
          { id: 'st-cm-whatsapp', labelAr: 'واتساب',            labelEn: 'WhatsApp', soon: true },
          { id: 'st-cm-notifications', labelAr: 'قواعد الإشعارات', labelEn: 'Notification Rules' },
        ],
      },
      {
        id: 'st-operational', labelAr: 'الإعدادات التشغيلية', labelEn: 'Operational Settings',
        children: [
          { id: 'st-op-cities',    labelAr: 'المدن',              labelEn: 'Cities' },
          { id: 'st-op-districts', labelAr: 'الأحياء',            labelEn: 'Districts' },
          { id: 'st-op-slots',     labelAr: 'فترات التوصيل',      labelEn: 'Delivery Slots' },
          { id: 'st-op-order-types', labelAr: 'أنواع الطلبات',    labelEn: 'Order Types' },
          { id: 'st-op-ticket-cats', labelAr: 'تصنيفات التذاكر',  labelEn: 'Ticket Categories' },
          { id: 'st-op-lead-sources', labelAr: 'مصادر الـ Leads', labelEn: 'Lead Sources' },
          { id: 'st-op-call-outcomes', labelAr: 'نتائج المكالمات', labelEn: 'Call Outcomes' },
          { id: 'st-op-statuses',  labelAr: 'الحالات',            labelEn: 'Statuses' },
          { id: 'st-op-slas',      labelAr: 'اتفاقيات SLA',       labelEn: 'SLAs' },
        ],
      },
      {
        id: 'st-security', labelAr: 'إعدادات الأمان', labelEn: 'Security Settings',
        children: [
          { id: 'st-sec-password', labelAr: 'سياسة كلمات المرور', labelEn: 'Password Policy' },
          { id: 'st-sec-mfa',      labelAr: 'التحقق الثنائي (MFA)', labelEn: 'MFA' },
          { id: 'st-sec-session',  labelAr: 'مهلة الجلسة',        labelEn: 'Session Timeout' },
          { id: 'st-sec-ip',       labelAr: 'قيود IP',            labelEn: 'IP Restrictions' },
          { id: 'st-sec-audit',    labelAr: 'سجلات التدقيق',      labelEn: 'Audit Logs' },
          { id: 'st-sec-logins',   labelAr: 'سجل الدخول',         labelEn: 'Login History' },
          { id: 'st-sec-devices',  labelAr: 'إدارة الأجهزة',      labelEn: 'Device Management' },
        ],
      },
      {
        id: 'st-integration', labelAr: 'إعدادات التكامل', labelEn: 'Integration Settings',
        children: [
          { id: 'st-int-orders',    labelAr: 'واجهة نظام الطلبات (API)', labelEn: 'Order System API' },
          { id: 'st-int-yeastar',   labelAr: 'واجهة Yeastar (API)',      labelEn: 'Yeastar API' },
          { id: 'st-int-sms',       labelAr: 'بوابة SMS',                labelEn: 'SMS Gateway' },
          { id: 'st-int-smtp',      labelAr: 'بريد SMTP',                labelEn: 'Email SMTP' },
          { id: 'st-int-insurance', labelAr: 'شركاء التأمين',            labelEn: 'Insurance Partners' },
          { id: 'st-int-external',  labelAr: 'أنظمة خارجية',             labelEn: 'External Systems' },
        ],
      },
    ],
  },
];

// فهرس مسطح: id الصفحة → { section, trail } للـ breadcrumb والعناوين
const PAGE_INDEX = (() => {
  const index = {};
  const walk = (section, items, trail) => {
    items.forEach(item => {
      index[item.id] = { section, item, trail };
      if (item.children) walk(section, item.children, [...trail, item]);
    });
  };
  SIDEBAR_SECTIONS.forEach(s => walk(s, s.items, []));
  return index;
})();

// ─────────────────────────────────────────────────────────────
// SIDEBAR COMPONENTS
// ─────────────────────────────────────────────────────────────
const SoonBadge = () => (
  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#f0e3d2] text-[#7a4d1d] font-body shrink-0">
    قريباً
  </span>
);

// عنصر تنقل (ورقة أو مجموعة فرعية) — recursive لدعم أي عمق
const NavItem = ({ item, depth, page, setPage, openGroups, toggleGroup, forceOpen }) => {
  const hasChildren = !!item.children?.length;
  const open = forceOpen || openGroups.includes(item.id);
  const active = page === item.id;
  const padding = { paddingRight: 12 + depth * 14 };

  if (hasChildren) {
    return (
      <div>
        <button
          onClick={() => toggleGroup(item.id)}
          className="w-full flex items-center gap-2 py-2 pl-3 rounded-lg text-[13px] font-body text-[#5c5141] hover:bg-[#f5f1e3] transition"
          style={padding}
        >
          <ChevronDown
            size={12}
            className={`shrink-0 transition-transform ${open ? '' : 'rotate-90'}`}
          />
          <span className="flex-1 text-right">{item.labelAr}</span>
          {item.soon && <SoonBadge/>}
        </button>
        {open && (
          <div className="space-y-0.5">
            {item.children.map(child => (
              <NavItem
                key={child.id}
                item={child}
                depth={depth + 1}
                page={page}
                setPage={setPage}
                openGroups={openGroups}
                toggleGroup={toggleGroup}
                forceOpen={forceOpen}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => setPage(item.id)}
      className={`w-full flex items-center gap-2 py-2 pl-3 rounded-lg text-[13px] font-body transition ${
        active
          ? 'bg-[#1a1d2e] text-[#fbf8f0]'
          : 'text-[#1a1d2e] hover:bg-[#f5f1e3]'
      }`}
      style={padding}
    >
      <span
        className={`w-1 h-1 rounded-full shrink-0 ${active ? 'bg-[#a86b2c]' : 'bg-[#d4cfc0]'}`}
      />
      <span className="flex-1 text-right truncate">{item.labelAr}</span>
      {item.soon && <SoonBadge/>}
    </button>
  );
};

// فلترة العناصر recursively حسب نص البحث (عربي أو إنجليزي)
const filterNavItems = (items, q) =>
  items
    .map(item => {
      const selfMatch =
        item.labelAr.toLowerCase().includes(q) ||
        item.labelEn.toLowerCase().includes(q);
      if (selfMatch) return item;
      if (item.children) {
        const kids = filterNavItems(item.children, q);
        if (kids.length) return { ...item, children: kids };
      }
      return null;
    })
    .filter(Boolean);

const Sidebar = ({ page, setPage, role }) => {
  const me = EMPLOYEES.find(e => e.id === CURRENT_EMPLOYEE_ID);
  const [openSections, setOpenSections] = useState(['customer-care']);
  const [openGroups, setOpenGroups] = useState([]);
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  const sections = useMemo(() => {
    if (!searching) return SIDEBAR_SECTIONS;
    return SIDEBAR_SECTIONS
      .map(s => {
        const sectionMatch =
          s.labelAr.toLowerCase().includes(q) ||
          s.labelEn.toLowerCase().includes(q);
        const items = filterNavItems(s.items, q);
        if (sectionMatch) return s;
        if (items.length) return { ...s, items };
        return null;
      })
      .filter(Boolean);
  }, [q, searching]);

  const toggleSection = (id) =>
    setOpenSections(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );

  const toggleGroup = (id) =>
    setOpenGroups(prev =>
      prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]
    );

  return (
    <aside className="w-72 h-screen sticky top-0 bg-[#fbf8f0] border-l border-[#e8e1cf] flex flex-col">
      {/* Brand */}
      <div className="p-6 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#1a1d2e] text-[#fbf8f0] flex items-center justify-center font-latin-serif text-lg font-bold">
            M
          </div>
          <div>
            <div className="font-display text-base text-[#1a1d2e] leading-tight">ميلاسيرف</div>
            <div className="text-[10px] text-[#857961] font-latin-serif tracking-wider">MILASERV · UPC</div>
          </div>
        </div>
      </div>

      {/* Nav search */}
      <div className="px-4 pb-3">
        <div className="relative">
          <Search size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#857961]"/>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="ابحث في القائمة..."
            className="w-full pr-8 pl-3 py-2 bg-[#f5f1e3] border border-[#e8e1cf] rounded-xl text-xs font-body focus:outline-none focus:border-[#1a1d2e]"
          />
        </div>
      </div>

      {/* Sections */}
      <nav className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="text-[10px] uppercase tracking-[0.25em] text-[#857961] font-latin-serif mb-2 px-2">
          الأقسام
        </div>
        <div className="space-y-1">
          {sections.length === 0 && (
            <div className="text-center py-6 text-xs text-[#857961] font-body">
              لا توجد نتائج مطابقة
            </div>
          )}
          {sections.map(sec => {
            const Icon = sec.icon;
            const open = searching || openSections.includes(sec.id);
            const containsActive = !!PAGE_INDEX[page] && PAGE_INDEX[page].section.id === sec.id;
            return (
              <div key={sec.id}>
                <button
                  onClick={() => toggleSection(sec.id)}
                  className={`w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl transition ${
                    containsActive && !open ? 'bg-[#f5f1e3]' : 'hover:bg-[#f5f1e3]'
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition ${
                      containsActive ? 'bg-[#1a1d2e] text-[#fbf8f0]' : 'bg-[#f5f1e3] text-[#5c5141]'
                    }`}
                  >
                    <Icon size={15}/>
                  </div>
                  <div className="flex-1 min-w-0 text-right">
                    <div className="font-body text-[13px] text-[#1a1d2e] font-medium truncate">
                      {sec.labelAr}
                    </div>
                    <div className="text-[9px] text-[#857961] font-latin-serif tracking-wide truncate">
                      {sec.subtitle || sec.labelEn}
                    </div>
                  </div>
                  <ChevronDown
                    size={13}
                    className={`text-[#857961] shrink-0 transition-transform ${open ? '' : 'rotate-90'}`}
                  />
                </button>
                {open && (
                  <div className="mt-1 mb-2 mr-4 pr-2 border-r border-[#e8e1cf] space-y-0.5">
                    {sec.items.map(item => (
                      <NavItem
                        key={item.id}
                        item={item}
                        depth={0}
                        page={page}
                        setPage={setPage}
                        openGroups={openGroups}
                        toggleGroup={toggleGroup}
                        forceOpen={searching}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Master Teams — الفرق الرئيسية */}
        {!searching && (
          <>
            <div className="text-[10px] uppercase tracking-[0.25em] text-[#857961] font-latin-serif mt-6 mb-2 px-2">
              الفرق الرئيسية · MASTER TEAMS
            </div>
            <div className="space-y-0.5">
              {Object.values(TEAMS).map(t => {
                const Icon = t.icon;
                const cnt = EMPLOYEES.filter(e => e.team === t.id).length;
                return (
                  <div key={t.id} className="flex items-center gap-3 px-2.5 py-1.5 text-sm">
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: t.soft, color: t.color }}
                    >
                      <Icon size={13}/>
                    </div>
                    <span className="font-body text-[12px] text-[#1a1d2e] flex-1 truncate">{t.name}</span>
                    <span className="text-xs text-[#857961] font-latin-serif">{cnt}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </nav>

      {/* User */}
      <div className="p-4 border-t border-[#e8e1cf]">
        <div className="flex items-center gap-3 p-3 bg-[#f5f1e3] rounded-xl">
          <Avatar emp={me} size={36}/>
          <div className="flex-1 min-w-0">
            <div className="font-body text-sm text-[#1a1d2e] truncate">{me.name}</div>
            <div className="text-xs text-[#857961] font-body truncate">
              {role === 'moderator' ? 'مدير النظام' : me.role}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};

// صفحة Placeholder للأقسام التي لم تُبنَ بعد
const PlaceholderView = ({ pageId }) => {
  const entry = PAGE_INDEX[pageId];
  if (!entry) return null;
  const { section, item, trail } = entry;
  const Icon = section.icon;
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow={`${section.labelEn.toUpperCase()} · ${section.labelAr}`}
        title={item.labelAr}
      />
      <Card className="p-14 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-[#f5f1e3] text-[#857961] flex items-center justify-center mb-5">
          <Icon size={24}/>
        </div>
        <div className="font-display text-xl text-[#1a1d2e] mb-2">هذه الصفحة قيد الإنشاء</div>
        <div className="text-sm text-[#857961] font-body mb-4">
          {item.labelEn}{item.soon ? ' — مخطط لها في مرحلة لاحقة' : ''}
        </div>
        <div className="inline-flex items-center gap-2 text-xs text-[#857961] font-body bg-[#f5f1e3] px-3 py-1.5 rounded-full">
          <Wrench size={12}/>
          {section.labelAr}
          {trail.map(t => ` ← ${t.labelAr}`).join('')}
          {` ← ${item.labelAr}`}
        </div>
      </Card>
    </div>
  );
};

export default function App() {
  const [role, setRole] = useState('moderator');
  const [page, setPage] = useState('cc-shift-dashboard');

  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [leaves, setLeaves] = useState(INITIAL_LEAVES);

  // ربط صفحات الـ Sidebar بالشاشات المبنية فعلاً — الباقي Placeholder
  const renderPage = () => {
    switch (page) {
      case 'cc-shift-dashboard':
        return role === 'moderator'
          ? <ModeratorOverview tasks={tasks} leaves={leaves}/>
          : <EmployeeOverview tasks={tasks} leaves={leaves}/>;
      case 'tm-task-assignment':
        return role === 'moderator'
          ? <ModeratorTasks tasks={tasks} setTasks={setTasks}/>
          : <PlaceholderView pageId={page}/>;
      case 'tm-teams':
        return <ModeratorTeams tasks={tasks}/>;
      case 'hr-vacation':
        return role === 'moderator'
          ? <ModeratorLeaves leaves={leaves} setLeaves={setLeaves}/>
          : <EmployeeLeave leaves={leaves} setLeaves={setLeaves}/>;
      case 'pf-agent-kpis':
        return <EmployeePerformance/>;
      default:
        return <PlaceholderView pageId={page}/>;
    }
  };

  return (
    <div dir="rtl" className="min-h-screen bg-[#f5f1e3] font-body text-[#1a1d2e]">
      <FontStyles/>

      <div className="flex">
        <Sidebar page={page} setPage={setPage} role={role}/>

        {/* Main */}
        <main className="flex-1 min-h-screen">
          {/* Top bar with role switcher */}
          <div className="sticky top-0 z-10 bg-[#f5f1e3]/95 backdrop-blur-md border-b border-[#e8e1cf]">
            <div className="flex items-center justify-between px-10 py-4">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#857961]"/>
                  <input
                    placeholder="ابحث في النظام..."
                    className="w-80 pr-9 pl-4 py-2 bg-[#fbf8f0] border border-[#e8e1cf] rounded-xl text-sm font-body focus:outline-none focus:border-[#1a1d2e]"
                  />
                </div>
              </div>

              {/* Role switcher */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-[#857961] font-body">عرض كـ:</span>
                <div className="flex items-center bg-[#fbf8f0] border border-[#e8e1cf] rounded-xl p-1">
                  <button
                    onClick={() => setRole('moderator')}
                    className={`px-4 py-1.5 rounded-lg text-sm font-body transition ${
                      role === 'moderator'
                        ? 'bg-[#1a1d2e] text-[#fbf8f0]'
                        : 'text-[#857961] hover:text-[#1a1d2e]'
                    }`}
                  >
                    مودريتور
                  </button>
                  <button
                    onClick={() => setRole('employee')}
                    className={`px-4 py-1.5 rounded-lg text-sm font-body transition ${
                      role === 'employee'
                        ? 'bg-[#1a1d2e] text-[#fbf8f0]'
                        : 'text-[#857961] hover:text-[#1a1d2e]'
                    }`}
                  >
                    موظف
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="px-10 py-8 max-w-[1200px]">
            {renderPage()}
          </div>
        </main>
      </div>
    </div>
  );
}
