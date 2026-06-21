import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  Modal, KeyboardAvoidingView, Platform, ActivityIndicator, Animated,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useShipments } from '@/hooks/useShipments';
import { useDrivers } from '@/hooks/useDrivers';
import { useClients } from '@/hooks/useClients';
import { Driver, Client, ContainerEntry, AdditionalDriver } from '@/types';
import { CreateShipmentInput } from '@/services/shipmentService';
import { Colors, FontSize, Spacing, BorderRadius, Shadow } from '@/constants/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
}

// ── Date Picker ───────────────────────────────────────────────────────────────
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_NAMES   = ['Su','Mo','Tu','We','Th','Fr','Sa'];

interface DatePickerProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  icon?: keyof typeof MaterialIcons.glyphMap;
  hint?: string;
}

function DatePickerField({ label, value, onChange, icon = 'event', hint }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const today = new Date();

  const parseValue = (): Date => {
    if (!value) return new Date(today);
    const d = new Date(value);
    return isNaN(d.getTime()) ? new Date(today) : d;
  };

  const [viewYear,  setViewYear]  = useState(() => parseValue().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => parseValue().getMonth());
  const [selected,  setSelected]  = useState<Date | null>(() => value ? parseValue() : null);

  const heightAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(heightAnim, {
      toValue: open ? 1 : 0, duration: 220, useNativeDriver: false,
    }).start();
  }, [open]);

  const calendarHeight = heightAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 310] });

  const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
  const firstDayOfWeek = (y: number, m: number) => new Date(y, m, 1).getDay();

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const formatDate = (d: Date) => {
    const dd = String(d.getDate()).padStart(2, '0');
    return `${dd} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  };

  const handleSelect = (day: number) => {
    const d = new Date(viewYear, viewMonth, day);
    setSelected(d);
    onChange(formatDate(d));
    setOpen(false);
  };

  const isToday = (day: number) =>
    day === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
  const isSelected = (day: number) => {
    if (!selected) return false;
    return day === selected.getDate() && viewMonth === selected.getMonth() && viewYear === selected.getFullYear();
  };
  const isPast = (day: number) => {
    const d = new Date(viewYear, viewMonth, day);
    return d < new Date(today.getFullYear(), today.getMonth(), today.getDate());
  };

  const totalDays   = daysInMonth(viewYear, viewMonth);
  const startOffset = firstDayOfWeek(viewYear, viewMonth);
  const cells: (number | null)[] = Array(startOffset).fill(null).concat(
    Array.from({ length: totalDays }, (_, i) => i + 1)
  );
  while (cells.length % 7 !== 0) cells.push(null);

  const quickOptions = [
    { label: 'Today', days: 0 }, { label: '+1d', days: 1 }, { label: '+3d', days: 3 },
    { label: '+7d', days: 7 }, { label: '+14d', days: 14 }, { label: '+30d', days: 30 },
  ];
  const applyQuick = (days: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    setViewYear(d.getFullYear()); setViewMonth(d.getMonth());
    setSelected(d); onChange(formatDate(d)); setOpen(false);
  };

  return (
    <View style={dpSt.wrap}>
      <View style={dpSt.labelRow}>
        <Text style={dpSt.label}>{label}</Text>
        {hint ? <Text style={dpSt.hint}>{hint}</Text> : null}
      </View>
      <Pressable
        style={({ pressed }) => [dpSt.trigger, open && dpSt.triggerOpen, pressed && { opacity: 0.85 }]}
        onPress={() => setOpen(v => !v)}
      >
        <MaterialIcons name={icon} size={15} color={open ? Colors.primary : Colors.textMuted} />
        <Text style={[dpSt.triggerText, value && dpSt.triggerTextFilled]}>
          {value || 'Select date'}
        </Text>
        {value ? (
          <Pressable onPress={() => { onChange(''); setSelected(null); setOpen(false); }} hitSlop={8}>
            <MaterialIcons name="close" size={13} color={Colors.textMuted} />
          </Pressable>
        ) : (
          <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={16} color={Colors.textMuted} />
        )}
      </Pressable>
      <Animated.View style={[dpSt.calendarWrap, { maxHeight: calendarHeight, overflow: 'hidden' }]}>
        <View style={dpSt.calendar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={dpSt.quickChips}>
            {quickOptions.map(opt => (
              <Pressable key={opt.label} style={dpSt.quickChip} onPress={() => applyQuick(opt.days)}>
                <Text style={dpSt.quickChipText}>{opt.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={dpSt.monthNav}>
            <Pressable style={dpSt.navBtn} onPress={prevMonth} hitSlop={8}>
              <MaterialIcons name="chevron-left" size={20} color={Colors.textPrimary} />
            </Pressable>
            <Text style={dpSt.monthTitle}>{MONTH_NAMES[viewMonth]} {viewYear}</Text>
            <Pressable style={dpSt.navBtn} onPress={nextMonth} hitSlop={8}>
              <MaterialIcons name="chevron-right" size={20} color={Colors.textPrimary} />
            </Pressable>
          </View>
          <View style={dpSt.dowRow}>
            {DAY_NAMES.map(d => <Text key={d} style={dpSt.dowLabel}>{d}</Text>)}
          </View>
          <View style={dpSt.grid}>
            {cells.map((day, idx) => {
              if (day === null) return <View key={`e-${idx}`} style={dpSt.cell} />;
              const sel  = isSelected(day);
              const tod  = isToday(day);
              const past = isPast(day);
              return (
                <Pressable
                  key={`d-${idx}`}
                  style={[dpSt.cell, sel && dpSt.cellSelected, tod && !sel && dpSt.cellToday]}
                  onPress={() => handleSelect(day)}
                >
                  <Text style={[
                    dpSt.cellText,
                    sel  && dpSt.cellTextSelected,
                    tod  && !sel && dpSt.cellTextToday,
                    past && !sel && dpSt.cellTextPast,
                  ]}>{day}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const dpSt = StyleSheet.create({
  wrap: { gap: 4 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: FontSize.sm, fontWeight: '500', color: Colors.textSecondary },
  hint: { fontSize: 10, color: Colors.textMuted, fontStyle: 'italic' },
  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, minHeight: 44, paddingVertical: 8,
  },
  triggerOpen: { borderColor: Colors.primary, backgroundColor: Colors.primaryGlow },
  triggerText: { flex: 1, fontSize: FontSize.base, color: Colors.textMuted },
  triggerTextFilled: { color: Colors.textPrimary, fontWeight: '500' },
  calendarWrap: {},
  calendar: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', marginTop: 4,
  },
  quickChips: {
    flexDirection: 'row', gap: 6, paddingHorizontal: Spacing.md, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  quickChip: {
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.full,
    paddingHorizontal: 12, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.25)',
  },
  quickChipText: { fontSize: 11, fontWeight: '700', color: Colors.primary },
  monthNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  navBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  monthTitle: { fontSize: FontSize.base, fontWeight: '700', color: Colors.textPrimary },
  dowRow: { flexDirection: 'row', paddingHorizontal: Spacing.sm, paddingTop: 8, paddingBottom: 4 },
  dowLabel: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: Colors.textMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: Spacing.sm, paddingBottom: Spacing.md },
  cell: { width: `${100/7}%` as any, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  cellSelected: { backgroundColor: Colors.primary, borderRadius: 20 },
  cellToday: { backgroundColor: Colors.primaryGlow, borderRadius: 20, borderWidth: 1, borderColor: Colors.primary },
  cellText: { fontSize: 13, fontWeight: '500', color: Colors.textPrimary },
  cellTextSelected: { color: '#fff', fontWeight: '700' },
  cellTextToday: { color: Colors.primary, fontWeight: '700' },
  cellTextPast: { color: Colors.textMuted, opacity: 0.5 },
});

// ── Preset data ────────────────────────────────────────────────────────────────
const PRESET_ORIGINS = [
  'Mersin, TR', 'Istanbul, TR', 'Ankara, TR', 'Gaziantep, TR',
  'Diyarbakir, TR', 'Habur, TR', 'Cizre, TR',
  'Dubai, AE', 'Jebel Ali, AE', 'Hamburg, DE', 'Rotterdam, NL',
  'Shanghai, CN', 'Guangzhou, CN', 'Genoa, IT', 'Antwerp, BE',
];
const PRESET_DESTINATIONS = [
  'Baghdad, IQ', 'Erbil, IQ', 'Sulaymaniyah, IQ', 'Mosul, IQ',
  'Basra, IQ', 'Kirkuk, IQ', 'Najaf, IQ', 'Karbala, IQ',
];
const CARGO_PRESETS = [
  'Industrial Machinery', 'Construction Equipment', 'Electronics',
  'Food & Beverages', 'Construction Materials', 'Pharmaceuticals',
  'Chemicals', 'Textiles & Apparel', 'Automotive Parts', 'Steel Products',
  'Household Goods', 'Plastic Raw Materials',
];
const PRESET_PORT_OF_LOADING = [
  'Mersin Port, TR', 'Istanbul (Ambarli) Port, TR', 'Iskenderun Port, TR',
  'Izmir Port, TR', 'Gemlik Port, TR', 'Derince Port (Kocaeli), TR', 'Bandirma Port, TR',
  'Jebel Ali Port, AE', 'Abu Dhabi Port, AE', 'Port of Salalah, OM',
  'Hamad Port, QA', 'King Abdullah Port, SA', 'Beirut Port, LB',
  'Rotterdam Port, NL', 'Hamburg Port, DE', 'Antwerp Port, BE',
  'Piraeus Port, GR', 'Genoa Port, IT', 'Valencia Port, ES',
  'Shanghai Port, CN', 'Guangzhou (Nansha) Port, CN', 'Ningbo Port, CN',
  'Singapore Port, SG', 'Busan Port, KR',
  'Port of New York, US', 'Port of Houston, US',
];
const PRESET_PORT_OF_DISCHARGE = [
  'Umm Qasr Port, IQ', 'Khor Al-Zubair Port, IQ', 'Maqal Port (Basra), IQ',
  'Abu Flus Port, IQ', 'Basra Port, IQ',
  'Aqaba Port, JO', 'Bandar Abbas Port, IR',
  'Shuwaikh Port, KW', 'Shuaiba Port, KW', 'Khalifa Port, AE',
];
const INCOTERMS = [
  { code: 'EXW', label: 'EX Works',                   desc: 'Buyer arranges all transport from seller warehouse' },
  { code: 'FCA', label: 'Free Carrier',               desc: 'Seller delivers to named place, buyer arranges main carriage' },
  { code: 'FOB', label: 'Free on Board',              desc: 'Seller loads at origin port, buyer arranges ocean freight' },
  { code: 'CFR', label: 'Cost & Freight',             desc: 'Seller pays freight to dest port, risk transfers at origin port' },
  { code: 'CIF', label: 'Cost, Insurance & Freight',  desc: 'Seller pays freight + insurance, risk at origin port' },
  { code: 'CPT', label: 'Carriage Paid To',           desc: 'Seller pays transport to named destination' },
  { code: 'CIP', label: 'Carriage & Insurance Paid',  desc: 'Seller pays transport + insurance to named destination' },
  { code: 'DAP', label: 'Delivered at Place',         desc: 'Seller responsible until delivery at destination' },
  { code: 'DPU', label: 'Delivered at Place Unloaded',desc: 'Seller responsible including unloading at destination' },
  { code: 'DDP', label: 'Delivered Duty Paid',        desc: 'Seller handles everything including import customs & duty' },
];
const CONTAINER_SIZES = ['20ft', '40ft', '40ft HC', '45ft', '20ft OT', '40ft OT'];
const CONTAINER_TYPES = ['Dry', 'Reefer', 'Open Top', 'Flat Rack', 'Tank', 'Bulk'];

function newKey() { return Math.random().toString(36).substring(2, 8); }

// ── Combobox ──────────────────────────────────────────────────────────────────
interface ComboboxProps {
  label: string; value: string; onChangeText: (v: string) => void;
  presets: string[]; placeholder?: string;
  icon?: keyof typeof MaterialIcons.glyphMap; required?: boolean; hint?: string;
}
function Combobox({ label, value, onChangeText, presets, placeholder, icon, required, hint }: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const filtered = value.trim()
    ? presets.filter(p => p.toLowerCase().includes(value.toLowerCase()) && p !== value)
    : presets;
  return (
    <View style={cbStyles.wrap}>
      <View style={cbStyles.labelRow}>
        <Text style={cbStyles.label}>{label}{required ? ' *' : ''}</Text>
        {hint ? <Text style={cbStyles.hint}>{hint}</Text> : null}
      </View>
      <View style={[cbStyles.inputRow, open && cbStyles.inputRowFocused]}>
        {icon && <MaterialIcons name={icon} size={15} color={Colors.textMuted} />}
        <TextInput
          style={cbStyles.input}
          value={value}
          onChangeText={v => { onChangeText(v); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          placeholderTextColor={Colors.textMuted}
          autoCapitalize="words"
        />
        {value ? (
          <Pressable onPress={() => { onChangeText(''); setOpen(false); }} hitSlop={8}>
            <MaterialIcons name="close" size={14} color={Colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {open && filtered.length > 0 && (
        <View style={cbStyles.suggestions}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: Spacing.sm, gap: 6, flexDirection: 'row', alignItems: 'center' }}>
            {filtered.map(p => (
              <Pressable key={p} style={({ pressed }) => [cbStyles.chip, pressed && { opacity: 0.8 }]}
                onPress={() => { onChangeText(p); setOpen(false); }}>
                <Text style={cbStyles.chipText}>{p}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

// ── Incoterms Selector ────────────────────────────────────────────────────────
function IncotermsSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const selected = INCOTERMS.find(t => t.code === value);
  return (
    <View style={incStyles.wrap}>
      <View style={incStyles.labelRow}>
        <Text style={incStyles.label}>Incoterms 2020</Text>
        <View style={incStyles.badge}><Text style={incStyles.badgeText}>Trade Terms</Text></View>
      </View>
      {selected ? (
        <View style={incStyles.selected}>
          <View style={incStyles.selectedLeft}>
            <View style={incStyles.codeChip}><Text style={incStyles.codeChipText}>{selected.code}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={incStyles.selectedLabel}>{selected.label}</Text>
              <Text style={incStyles.selectedDesc} numberOfLines={2}>{selected.desc}</Text>
            </View>
          </View>
          <Pressable onPress={() => onChange('')} style={incStyles.clearBtn} hitSlop={8}>
            <MaterialIcons name="close" size={14} color={Colors.textMuted} />
          </Pressable>
        </View>
      ) : (
        <Pressable style={({ pressed }) => [incStyles.trigger, pressed && { opacity: 0.8 }]} onPress={() => setExpanded(v => !v)}>
          <MaterialIcons name="handshake" size={16} color={Colors.textMuted} />
          <Text style={incStyles.triggerText}>Select trade terms (optional)</Text>
          <MaterialIcons name={expanded ? 'expand-less' : 'expand-more'} size={16} color={Colors.textMuted} />
        </Pressable>
      )}
      {expanded && !selected && (
        <View style={incStyles.list}>
          {INCOTERMS.map((term, i) => (
            <Pressable key={term.code}
              style={({ pressed }) => [incStyles.termItem, i < INCOTERMS.length - 1 && incStyles.termBorder, pressed && { backgroundColor: Colors.cardHover }]}
              onPress={() => { onChange(term.code); setExpanded(false); }}>
              <View style={incStyles.termCode}><Text style={incStyles.termCodeText}>{term.code}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={incStyles.termLabel}>{term.label}</Text>
                <Text style={incStyles.termDesc} numberOfLines={2}>{term.desc}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Container List Editor ─────────────────────────────────────────────────────
interface ContainerEditorProps {
  containers: (ContainerEntry & { key: string })[];
  onChange: (list: (ContainerEntry & { key: string })[]) => void;
}
function ContainerEditor({ containers, onChange }: ContainerEditorProps) {
  const addContainer = () => {
    onChange([...containers, { key: newKey(), container_number: '', seal_number: '', size: '20ft', type: 'Dry', weight: '' }]);
  };
  const remove = (key: string) => onChange(containers.filter(c => c.key !== key));
  const update = (key: string, field: keyof ContainerEntry, val: string) =>
    onChange(containers.map(c => c.key === key ? { ...c, [field]: val } : c));
  return (
    <View style={ctSt.wrap}>
      <View style={ctSt.header}>
        <View style={ctSt.headerLeft}>
          <MaterialIcons name="inventory-2" size={13} color={'#38BDF8'} />
          <Text style={ctSt.headerTitle}>CONTAINERS</Text>
          <View style={ctSt.countPill}><Text style={ctSt.countText}>{containers.length}</Text></View>
        </View>
        <Pressable style={({ pressed }) => [ctSt.addBtn, pressed && { opacity: 0.75 }]} onPress={addContainer}>
          <MaterialIcons name="add" size={14} color={Colors.primary} />
          <Text style={ctSt.addBtnText}>Add Container</Text>
        </Pressable>
      </View>
      {containers.length === 0 ? (
        <Pressable style={ctSt.emptyCard} onPress={addContainer}>
          <MaterialIcons name="inventory-2" size={22} color={Colors.border} />
          <Text style={ctSt.emptyText}>No containers yet</Text>
          <Text style={ctSt.emptySubText}>Tap to add the first container</Text>
        </Pressable>
      ) : (
        containers.map((c, idx) => (
          <View key={c.key} style={ctSt.card}>
            <View style={ctSt.cardHeader}>
              <View style={ctSt.cardIndexBadge}><Text style={ctSt.cardIndexText}>{idx + 1}</Text></View>
              <Text style={ctSt.cardTitle}>Container #{idx + 1}</Text>
              <Pressable onPress={() => remove(c.key)} hitSlop={8}>
                <MaterialIcons name="delete-outline" size={16} color={Colors.danger} />
              </Pressable>
            </View>
            <View style={ctSt.fieldRow}>
              <MaterialIcons name="inventory-2" size={13} color={Colors.textMuted} />
              <TextInput style={ctSt.fieldInput} value={c.container_number}
                onChangeText={v => update(c.key, 'container_number', v)}
                placeholder="Container No. (e.g. MSCU1234567)"
                placeholderTextColor={Colors.textMuted} autoCapitalize="characters" />
            </View>
            <View style={ctSt.twoFieldRow}>
              <View style={[ctSt.fieldRow, { flex: 1 }]}>
                <MaterialIcons name="lock" size={13} color={Colors.textMuted} />
                <TextInput style={ctSt.fieldInput} value={c.seal_number ?? ''}
                  onChangeText={v => update(c.key, 'seal_number', v)}
                  placeholder="Seal No." placeholderTextColor={Colors.textMuted} autoCapitalize="characters" />
              </View>
              <View style={[ctSt.fieldRow, { flex: 1 }]}>
                <MaterialIcons name="straighten" size={13} color={Colors.textMuted} />
                <TextInput style={ctSt.fieldInput} value={c.weight ?? ''}
                  onChangeText={v => update(c.key, 'weight', v)}
                  placeholder="Weight" placeholderTextColor={Colors.textMuted} />
              </View>
            </View>
            <View style={ctSt.chipsSection}>
              <Text style={ctSt.chipLabel}>Size</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ctSt.chipsRow}>
                {CONTAINER_SIZES.map(s => (
                  <Pressable key={s} style={[ctSt.chip, c.size === s && ctSt.chipActive]} onPress={() => update(c.key, 'size', s)}>
                    <Text style={[ctSt.chipText, c.size === s && ctSt.chipTextActive]}>{s}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
            <View style={ctSt.chipsSection}>
              <Text style={ctSt.chipLabel}>Type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ctSt.chipsRow}>
                {CONTAINER_TYPES.map(t => (
                  <Pressable key={t} style={[ctSt.chip, c.type === t && ctSt.chipActive]} onPress={() => update(c.key, 'type', t)}>
                    <Text style={[ctSt.chipText, c.type === t && ctSt.chipTextActive]}>{t}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

// ── Additional Drivers Editor ─────────────────────────────────────────────────
interface AdditionalDriverEditorProps {
  drivers: Driver[];
  additionalDrivers: (AdditionalDriver & { key: string })[];
  primaryDriverId?: string;
  onChange: (list: (AdditionalDriver & { key: string })[]) => void;
}
function AdditionalDriverEditor({ drivers, additionalDrivers, primaryDriverId, onChange }: AdditionalDriverEditorProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState('');
  const usedIds = [primaryDriverId, ...additionalDrivers.map(d => d.driver_id)].filter(Boolean) as string[];
  const available = drivers.filter(d =>
    !usedIds.includes(d.id) &&
    (!search.trim() || d.fullName.toLowerCase().includes(search.toLowerCase()) || d.plateNumber.toLowerCase().includes(search.toLowerCase()))
  );
  const remove = (key: string) => onChange(additionalDrivers.filter(d => d.key !== key));
  const pickDriver = (d: Driver) => {
    onChange([...additionalDrivers, { key: newKey(), driver_id: d.id, driver_name: d.fullName, plate_number: d.plateNumber, truck_class: d.truckClass }]);
    setShowPicker(false); setSearch('');
  };
  return (
    <View style={adSt.wrap}>
      <View style={adSt.header}>
        <View style={adSt.headerLeft}>
          <MaterialIcons name="local-shipping" size={13} color={Colors.primary} />
          <Text style={adSt.headerTitle}>ADDITIONAL TRUCKS</Text>
          {additionalDrivers.length > 0 && (
            <View style={adSt.countPill}><Text style={adSt.countText}>+{additionalDrivers.length}</Text></View>
          )}
        </View>
        <Pressable style={({ pressed }) => [adSt.addBtn, pressed && { opacity: 0.75 }]} onPress={() => setShowPicker(true)}>
          <MaterialIcons name="person-add" size={14} color={Colors.primary} />
          <Text style={adSt.addBtnText}>Add Truck</Text>
        </Pressable>
      </View>
      {additionalDrivers.length === 0 ? (
        <View style={adSt.empty}>
          <MaterialIcons name="local-shipping" size={20} color={Colors.border} />
          <Text style={adSt.emptyText}>Single truck — add more if needed</Text>
        </View>
      ) : (
        additionalDrivers.map((d, idx) => (
          <View key={d.key} style={adSt.driverCard}>
            <View style={adSt.driverAvatar}>
              <Text style={adSt.driverAvatarText}>
                {d.driver_name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={adSt.driverNameRow}>
                <View style={adSt.truckNumBadge}><Text style={adSt.truckNumText}>Truck {idx + 2}</Text></View>
                <Text style={adSt.driverName} numberOfLines={1}>{d.driver_name}</Text>
              </View>
              <Text style={adSt.driverMeta}>{d.plate_number}{d.truck_class ? ` · ${d.truck_class}` : ''}</Text>
            </View>
            <Pressable onPress={() => remove(d.key)} hitSlop={8}>
              <MaterialIcons name="close" size={16} color={Colors.danger} />
            </Pressable>
          </View>
        ))
      )}
      <Modal visible={showPicker} animationType="slide" presentationStyle="formSheet" onRequestClose={() => { setShowPicker(false); setSearch(''); }}>
        <PickerModal title="Add Truck / Driver" subtitle={`${available.length} available drivers`}
          searchValue={search} onSearchChange={setSearch} searchPlaceholder="Search by name or plate..."
          onClose={() => { setShowPicker(false); setSearch(''); }}>
          {available.length === 0
            ? <PickerEmpty text={drivers.length === 0 ? 'No drivers registered' : 'No more drivers available'} />
            : available.map(d => <DriverPickerItem key={d.id} driver={d} active={false} onPress={() => pickDriver(d)} />)}
        </PickerModal>
      </Modal>
    </View>
  );
}

// ── Accordion Section ─────────────────────────────────────────────────────────
interface AccordionProps {
  icon: keyof typeof MaterialIcons.glyphMap;
  iconColor?: string;
  title: string;
  badge?: string;
  badgeColor?: string;
  complete?: boolean;
  required?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}
function Accordion({ icon, iconColor = Colors.primary, title, badge, badgeColor, complete, required, defaultOpen = false, children }: AccordionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const heightAnim = useRef(new Animated.Value(defaultOpen ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(heightAnim, { toValue: open ? 1 : 0, duration: 200, useNativeDriver: false }).start();
  }, [open]);

  return (
    <View style={accSt.wrap}>
      <Pressable
        style={({ pressed }) => [accSt.header, open && accSt.headerOpen, pressed && { opacity: 0.85 }]}
        onPress={() => setOpen(v => !v)}
      >
        <View style={[accSt.iconWrap, open && { backgroundColor: `${iconColor}20`, borderColor: `${iconColor}40` }]}>
          <MaterialIcons name={icon} size={14} color={open ? iconColor : Colors.textMuted} />
        </View>
        <Text style={[accSt.title, open && { color: Colors.textPrimary }]}>{title}</Text>
        {required && !complete && <View style={accSt.reqDot} />}
        {badge ? (
          <View style={[accSt.badge, { backgroundColor: `${badgeColor ?? Colors.primary}18`, borderColor: `${badgeColor ?? Colors.primary}30` }]}>
            <Text style={[accSt.badgeText, { color: badgeColor ?? Colors.primary }]}>{badge}</Text>
          </View>
        ) : null}
        {complete && (
          <View style={accSt.completeBadge}>
            <MaterialIcons name="check-circle" size={14} color={Colors.success} />
          </View>
        )}
        <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={18} color={Colors.textMuted} />
      </Pressable>
      {open && (
        <View style={accSt.body}>
          {children}
        </View>
      )}
    </View>
  );
}

const accSt = StyleSheet.create({
  wrap: { borderRadius: BorderRadius.lg, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.lg, paddingVertical: 13,
    backgroundColor: Colors.card,
  },
  headerOpen: { backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  iconWrap: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { flex: 1, fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  reqDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.warning },
  badge: {
    borderRadius: BorderRadius.full, paddingHorizontal: 8, paddingVertical: 2,
    borderWidth: 1,
  },
  badgeText: { fontSize: 10, fontWeight: '700' },
  completeBadge: { marginLeft: 2 },
  body: { backgroundColor: Colors.bg, padding: Spacing.lg, gap: Spacing.lg },
});

// ── Success Screen ────────────────────────────────────────────────────────────
function SuccessScreen({ tirNumber, shipmentType, onDone }: { tirNumber: string; shipmentType: string; onDone: () => void }) {
  const scaleAnim = useRef(new Animated.Value(0.6)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 200, friction: 10 }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
  }, []);

  const typeIcon = shipmentType === 'Air' ? 'flight' : shipmentType === 'Sea' ? 'directions-boat' : 'local-shipping';
  const typeColor = shipmentType === 'Air' ? Colors.info : shipmentType === 'Sea' ? '#58C4DC' : Colors.primary;

  return (
    <Animated.View style={[sucSt.root, { opacity: opacityAnim }]}>
      <Animated.View style={[sucSt.iconWrap, { transform: [{ scale: scaleAnim }] }]}>
        <View style={sucSt.iconBg}>
          <MaterialIcons name="check" size={44} color={Colors.success} />
        </View>
        <View style={[sucSt.typeIconBadge, { backgroundColor: `${typeColor}20`, borderColor: `${typeColor}40` }]}>
          <MaterialIcons name={typeIcon as any} size={16} color={typeColor} />
        </View>
      </Animated.View>

      <Text style={sucSt.headline}>Shipment Created!</Text>
      <Text style={sucSt.sub}>Your shipment has been saved and is now active in the system.</Text>

      <View style={sucSt.tirCard}>
        <Text style={sucSt.tirLabel}>SHIPMENT NUMBER</Text>
        <Text style={sucSt.tirValue}>{tirNumber}</Text>
        <View style={[sucSt.typePill, { backgroundColor: `${typeColor}15`, borderColor: `${typeColor}30` }]}>
          <MaterialIcons name={typeIcon as any} size={11} color={typeColor} />
          <Text style={[sucSt.typePillText, { color: typeColor }]}>{shipmentType} Shipment</Text>
        </View>
      </View>

      <View style={sucSt.nextStepsList}>
        {[
          { icon: 'person-add' as const, text: 'Assign a driver from the shipment detail' },
          { icon: 'share' as const,      text: 'Share the tracking link with your client' },
          { icon: 'update' as const,     text: 'Update status as the shipment progresses' },
        ].map((step, i) => (
          <View key={i} style={sucSt.nextStep}>
            <View style={sucSt.nextStepIcon}>
              <MaterialIcons name={step.icon} size={13} color={Colors.primary} />
            </View>
            <Text style={sucSt.nextStepText}>{step.text}</Text>
          </View>
        ))}
      </View>

      <Pressable
        style={({ pressed }) => [sucSt.doneBtn, pressed && { opacity: 0.88 }]}
        onPress={onDone}
      >
        <MaterialIcons name="check" size={18} color="#fff" />
        <Text style={sucSt.doneBtnText}>Done</Text>
      </Pressable>
    </Animated.View>
  );
}

const sucSt = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.lg },
  iconWrap: { position: 'relative', marginBottom: Spacing.sm },
  iconBg: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: `${Colors.success}15`, borderWidth: 2, borderColor: `${Colors.success}40`,
    alignItems: 'center', justifyContent: 'center',
  },
  typeIconBadge: {
    position: 'absolute', bottom: 0, right: -4,
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.card,
  },
  headline: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 21, maxWidth: 300 },
  tirCard: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.xl,
    borderWidth: 1.5, borderColor: Colors.primary,
    padding: Spacing.xl, alignItems: 'center', gap: Spacing.sm,
    width: '100%',
  },
  tirLabel: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1 },
  tirValue: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.primary, fontFamily: 'monospace', letterSpacing: 1 },
  typePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: BorderRadius.full, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1,
  },
  typePillText: { fontSize: FontSize.xs, fontWeight: '700' },
  nextStepsList: { width: '100%', gap: Spacing.sm },
  nextStep: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.md,
  },
  nextStepIcon: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  nextStepText: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 19 },
  doneBtn: {
    width: '100%', backgroundColor: Colors.success, borderRadius: BorderRadius.lg,
    paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  doneBtnText: { color: '#fff', fontSize: FontSize.base, fontWeight: '700' },
});

// ── Main Component ─────────────────────────────────────────────────────────────
export function AddShipmentModal({ visible, onClose }: Props) {
  const { addShipment } = useShipments();
  const { drivers } = useDrivers();
  const { clients } = useClients();

  // ── Form state ──────────────────────────────────────────────────────────────
  const [tirNumber, setTirNumber]   = useState('ETR-...');
  const [tirLoading, setTirLoading] = useState(false);
  const [shipmentType, setShipmentType] = useState<'Road' | 'Air' | 'Sea'>('Road');

  const [origin, setOrigin]           = useState('');
  const [destination, setDestination] = useState('');
  const [cargoDescription, setCargoDescription] = useState('');
  const [cargoValue, setCargoValue]             = useState('');
  const [weight, setWeight]                     = useState('');
  const [estimatedArrival, setEstimatedArrival] = useState('');
  const [agreedPrice, setAgreedPrice]           = useState('');
  const [notes, setNotes]                       = useState('');

  // Air
  const [airlineCarrier, setAirlineCarrier] = useState('');
  const [flightNumber, setFlightNumber]     = useState('');
  const [mawbNumber, setMawbNumber]         = useState('');
  const [hawbNumber, setHawbNumber]         = useState('');
  const [airportOfOrigin, setAirportOfOrigin]       = useState('');
  const [airportOfDestination, setAirportOfDest]    = useState('');
  const [boardingTerminal, setBoardingTerminal]      = useState('');

  // Sea
  const [vesselName, setVesselName]           = useState('');
  const [voyageNumber, setVoyageNumber]       = useState('');
  const [bolNumber, setBolNumber]             = useState('');
  const [portOfLoading, setPortOfLoading]     = useState('');
  const [portOfDischarge, setPortOfDischarge] = useState('');
  const [shippingLine, setShippingLine]       = useState('');
  const [incoterms, setIncoterms]             = useState('');
  const [containers, setContainers]           = useState<(ContainerEntry & { key: string })[]>([]);

  // Client
  const [selectedClient, setSelectedClient]     = useState<Client | null>(null);
  const [clientSearch, setClientSearch]         = useState('');
  const [showClientPicker, setShowClientPicker] = useState(false);

  // Drivers
  const [selectedDriver, setSelectedDriver]                   = useState<Driver | null>(null);
  const [driverSearch, setDriverSearch]                       = useState('');
  const [showDriverPicker, setShowDriverPicker]               = useState(false);
  const [arrivalDriver, setArrivalDriver]                     = useState<Driver | null>(null);
  const [arrivalDriverSearch, setArrivalDriverSearch]         = useState('');
  const [showArrivalDriverPicker, setShowArrivalDriverPicker] = useState(false);
  const [additionalDrivers, setAdditionalDrivers]             = useState<(AdditionalDriver & { key: string })[]>([]);

  // Checkpoints
  const [checkpoints, setCheckpoints] = useState<{ key: string; name: string; location: string }[]>([
    { key: newKey(), name: '', location: '' },
  ]);

  // UI state
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [step, setStep]           = useState<1 | 2>(1);
  const [savedTir, setSavedTir]   = useState('');
  const [showSuccess, setShowSuccess] = useState(false);

  // Load ETR number on open
  useEffect(() => {
    if (!visible) return;
    setTirLoading(true);
    import('@/services/shipmentService').then(({ getNextEtrNumber }) => {
      getNextEtrNumber().then(next => { setTirNumber(next); setTirLoading(false); });
    });
  }, [visible]);

  const resetForm = useCallback(() => {
    setTirNumber('ETR-...');
    setShipmentType('Road');
    setOrigin(''); setDestination('');
    setCargoDescription(''); setCargoValue(''); setWeight('');
    setEstimatedArrival(''); setAgreedPrice(''); setNotes('');
    setAirlineCarrier(''); setFlightNumber(''); setMawbNumber('');
    setHawbNumber(''); setAirportOfOrigin(''); setAirportOfDest('');
    setBoardingTerminal('');
    setVesselName(''); setVoyageNumber(''); setBolNumber('');
    setContainers([]);
    setPortOfLoading(''); setPortOfDischarge('');
    setShippingLine(''); setIncoterms('');
    setSelectedClient(null); setClientSearch('');
    setSelectedDriver(null); setDriverSearch('');
    setArrivalDriver(null); setArrivalDriverSearch('');
    setAdditionalDrivers([]);
    setCheckpoints([{ key: newKey(), name: '', location: '' }]);
    setError(''); setStep(1); setShowSuccess(false); setSavedTir('');
  }, []);

  const handleClose = () => { resetForm(); onClose(); };

  const handleNext = () => {
    if (!origin.trim())           { setError('Origin is required.');            return; }
    if (!destination.trim())      { setError('Destination is required.');       return; }
    if (!cargoDescription.trim()) { setError('Cargo description is required.'); return; }
    if (!weight.trim())           { setError('Weight is required.');            return; }
    setError(''); setStep(2);
  };

  const addCheckpoint = () =>
    setCheckpoints(prev => [...prev, { key: newKey(), name: '', location: '' }]);
  const removeCheckpoint = (key: string) =>
    setCheckpoints(prev => prev.filter(cp => cp.key !== key));
  const updateCheckpoint = (key: string, field: 'name' | 'location', value: string) =>
    setCheckpoints(prev => prev.map(cp => cp.key === key ? { ...cp, [field]: value } : cp));

  const handleSave = async () => {
    const validCps = checkpoints.filter(cp => cp.name.trim());
    setError(''); setSaving(true);
    const input: CreateShipmentInput = {
      tirNumber: tirNumber.trim(),
      origin: origin.trim(), destination: destination.trim(),
      driverId: selectedDriver?.id ?? null,
      driverName: selectedDriver?.fullName ?? 'Unassigned',
      plateNumber: selectedDriver?.plateNumber ?? '—',
      cargoDescription: cargoDescription.trim(),
      cargoValue: cargoValue.trim() || undefined,
      weight: weight.trim(),
      estimatedArrival: estimatedArrival.trim() || 'TBD',
      checkpoints: validCps.map(cp => ({ name: cp.name.trim(), location: cp.location.trim() })),
      agreedPrice: agreedPrice.trim() || undefined,
      notes: notes.trim() || undefined,
      shipmentType,
      clientId: selectedClient?.id,
      clientName: selectedClient?.name,
      airlineCarrier: airlineCarrier.trim() || undefined,
      flightNumber: flightNumber.trim() || undefined,
      mawbNumber: mawbNumber.trim() || undefined,
      hawbNumber: hawbNumber.trim() || undefined,
      airportOfOrigin: airportOfOrigin.trim() || undefined,
      airportOfDestination: airportOfDestination.trim() || undefined,
      boardingTerminal: boardingTerminal.trim() || undefined,
      vesselName: vesselName.trim() || undefined,
      voyageNumber: voyageNumber.trim() || undefined,
      bolNumber: bolNumber.trim() || undefined,
      containers: containers.map(({ key: _k, ...c }) => c),
      portOfLoading: portOfLoading.trim() || undefined,
      portOfDischarge: portOfDischarge.trim() || undefined,
      shippingLine: shippingLine.trim() || undefined,
      incoterms: incoterms || undefined,
      arrivalDriverId: arrivalDriver?.id,
      arrivalDriverName: arrivalDriver?.fullName,
      arrivalDriverPlate: arrivalDriver?.plateNumber,
      additionalDrivers: additionalDrivers.map(({ key: _k, ...d }) => d),
    };
    const { error: saveError } = await addShipment(input);
    setSaving(false);
    if (saveError) { setError(saveError); return; }
    setSavedTir(tirNumber.trim());
    setShowSuccess(true);
  };

  const filteredClients = clients.filter(c =>
    !clientSearch.trim() ||
    c.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
    (c.company ?? '').toLowerCase().includes(clientSearch.toLowerCase()) ||
    (c.email ?? '').toLowerCase().includes(clientSearch.toLowerCase())
  );
  const filteredDrivers = drivers.filter(d =>
    !driverSearch.trim() ||
    d.fullName.toLowerCase().includes(driverSearch.toLowerCase()) ||
    d.plateNumber.toLowerCase().includes(driverSearch.toLowerCase())
  );
  const filteredArrivalDrivers = drivers.filter(d =>
    !arrivalDriverSearch.trim() ||
    d.fullName.toLowerCase().includes(arrivalDriverSearch.toLowerCase()) ||
    d.plateNumber.toLowerCase().includes(arrivalDriverSearch.toLowerCase())
  );

  // Completion indicators for accordion headers
  const routeComplete    = !!(origin.trim() && destination.trim());
  const cargoComplete    = !!(cargoDescription.trim() && weight.trim());
  const driverComplete   = !!selectedDriver;
  const clientComplete   = !!selectedClient;
  const airComplete      = shipmentType === 'Air' && !!(mawbNumber.trim());
  const seaComplete      = shipmentType === 'Sea' && !!(bolNumber.trim());

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIcon}>
              <MaterialIcons name={showSuccess ? 'check-circle' : 'add-box'} size={20} color={showSuccess ? Colors.success : Colors.primary} />
            </View>
            <View>
              <Text style={styles.headerTitle}>
                {showSuccess ? 'Shipment Created' : 'New Shipment'}
              </Text>
              <Text style={styles.headerSub}>
                {showSuccess
                  ? tirNumber
                  : step === 1 ? 'Step 1 of 2 — Manifest & Cargo' : 'Step 2 of 2 — Checkpoints & Notes'}
              </Text>
            </View>
          </View>
          <Pressable style={styles.closeBtn} onPress={handleClose}>
            <MaterialIcons name="close" size={18} color={Colors.textSecondary} />
          </Pressable>
        </View>

        {!showSuccess && (
          <>
            {/* Progress bar */}
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: step === 1 ? '50%' : '100%' }]} />
            </View>
            {/* Step indicators */}
            <View style={styles.stepsRow}>
              {[{ n: 1, label: 'Manifest' }, { n: 2, label: 'Checkpoints' }].map(s => (
                <View key={s.n} style={styles.stepItem}>
                  <View style={[styles.stepCircle, step >= s.n && styles.stepCircleActive]}>
                    {step > s.n
                      ? <MaterialIcons name="check" size={12} color="#fff" />
                      : <Text style={[styles.stepNum, step === s.n && { color: '#fff' }]}>{s.n}</Text>}
                  </View>
                  <Text style={[styles.stepLabel, step >= s.n && styles.stepLabelActive]}>{s.label}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ── Success screen ── */}
        {showSuccess ? (
          <SuccessScreen tirNumber={savedTir} shipmentType={shipmentType} onDone={handleClose} />
        ) : (
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {step === 1 ? (
              <View style={styles.form}>

                {/* ── Transport Mode ── */}
                <View style={styles.transportSection}>
                  <Text style={styles.transportLabel}>TRANSPORT MODE</Text>
                  <View style={styles.transportModeRow}>
                    {([
                      { type: 'Road' as const, icon: 'local-shipping' as const, label: 'Road', color: Colors.primary,   sub: 'Truck / Ground' },
                      { type: 'Air'  as const, icon: 'flight'          as const, label: 'Air',  color: Colors.info,     sub: 'Air Freight' },
                      { type: 'Sea'  as const, icon: 'directions-boat' as const, label: 'Sea',  color: '#38BDF8',       sub: 'Ocean Freight' },
                    ]).map(opt => {
                      const isActive = shipmentType === opt.type;
                      return (
                        <Pressable
                          key={opt.type}
                          style={({ pressed }) => [
                            styles.transportBtn,
                            isActive && { borderColor: opt.color, backgroundColor: `${opt.color}12` },
                            pressed && { opacity: 0.85 },
                          ]}
                          onPress={() => setShipmentType(opt.type)}
                        >
                          {isActive && <View style={[styles.transportBtnAccent, { backgroundColor: opt.color }]} />}
                          <MaterialIcons name={opt.icon} size={24} color={isActive ? opt.color : Colors.textMuted} />
                          <Text style={[styles.transportBtnLabel, isActive && { color: opt.color, fontWeight: '700' }]}>{opt.label}</Text>
                          <Text style={[styles.transportBtnSub, isActive && { color: `${opt.color}AA` }]}>{opt.sub}</Text>
                          {isActive && (
                            <View style={[styles.transportCheck, { backgroundColor: opt.color }]}>
                              <MaterialIcons name="check" size={9} color="#fff" />
                            </View>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                {/* ── Shipment Number ── */}
                <View style={styles.tirRow}>
                  <View style={styles.tirLeft}>
                    <MaterialIcons name="auto-fix-high" size={13} color={Colors.primary} />
                    <Text style={styles.tirAutoLabel}>Auto-generated number</Text>
                  </View>
                  <View style={styles.tirRight}>
                    {tirLoading
                      ? <ActivityIndicator size="small" color={Colors.primary} style={{ marginRight: 8 }} />
                      : <Text style={styles.tirValue}>{tirNumber}</Text>}
                    <Pressable
                      style={({ pressed }) => [styles.regenBtn, pressed && { opacity: 0.75 }, tirLoading && { opacity: 0.5 }]}
                      onPress={() => {
                        setTirLoading(true);
                        import('@/services/shipmentService').then(({ getNextEtrNumber }) => {
                          getNextEtrNumber().then(next => { setTirNumber(next); setTirLoading(false); });
                        });
                      }}
                      disabled={tirLoading} hitSlop={8}
                    >
                      <MaterialIcons name="refresh" size={15} color={Colors.primary} />
                    </Pressable>
                  </View>
                </View>

                {/* ── Route Accordion ── */}
                <Accordion icon="route" title="Route" required complete={routeComplete} defaultOpen>
                  <View style={styles.twoCol}>
                    <View style={{ flex: 1 }}>
                      <Combobox label="Origin *" value={origin} onChangeText={setOrigin}
                        presets={PRESET_ORIGINS} placeholder="City, Country" icon="trip-origin" required />
                    </View>
                    <View style={styles.routeArrow}>
                      <MaterialIcons name="arrow-forward" size={16} color={Colors.textMuted} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Combobox label="Destination *" value={destination} onChangeText={setDestination}
                        presets={PRESET_DESTINATIONS} placeholder="City, Country" icon="place" required />
                    </View>
                  </View>
                </Accordion>

                {/* ── Cargo Accordion ── */}
                <Accordion icon="inventory" title="Cargo" required complete={cargoComplete}>
                  <Combobox label="Cargo Description *" value={cargoDescription} onChangeText={setCargoDescription}
                    presets={CARGO_PRESETS} placeholder="e.g. Industrial Machinery Parts" icon="category" required />
                  <View style={styles.twoCol}>
                    <View style={{ flex: 1 }}>
                      <FormField label="Gross Weight *" value={weight} onChangeText={setWeight}
                        placeholder="e.g. 18,200 kg" icon="scale" required />
                    </View>
                    <View style={{ flex: 1 }}>
                      <FormField label="Cargo Value" value={cargoValue} onChangeText={setCargoValue}
                        placeholder="e.g. $45,000" icon="attach-money" hint="Optional" />
                    </View>
                  </View>
                </Accordion>

                {/* ── Logistics Accordion ── */}
                <Accordion icon="settings" title="Logistics & Pricing">
                  <DatePickerField
                    label={shipmentType === 'Sea' ? 'Port ETA' : 'Est. Arrival'}
                    value={estimatedArrival} onChange={setEstimatedArrival}
                    icon={shipmentType === 'Sea' ? 'directions-boat' : 'event'}
                    hint="Tap to pick from calendar"
                  />
                  <FormField label="Agreed Price" value={agreedPrice} onChangeText={setAgreedPrice}
                    placeholder="e.g. $2,400" icon="handshake" hint="Agent / Driver" />
                  <View style={styles.notesWrap}>
                    <View style={styles.notesLabelRow}>
                      <MaterialIcons name="notes" size={13} color={Colors.textMuted} />
                      <Text style={styles.notesLabel}>Notes / Instructions</Text>
                      <Text style={styles.notesHint}>Optional</Text>
                    </View>
                    <TextInput
                      style={styles.notesInput}
                      value={notes}
                      onChangeText={setNotes}
                      placeholder="Customs instructions, handling notes, client remarks…"
                      placeholderTextColor={Colors.textMuted}
                      multiline numberOfLines={3} textAlignVertical="top"
                    />
                  </View>
                </Accordion>

                {/* ── Air Freight Accordion ── */}
                {shipmentType === 'Air' && (
                  <Accordion icon="flight" iconColor={Colors.info} title="Air Freight Details"
                    badge={mawbNumber ? 'Filled' : 'Pending'} badgeColor={mawbNumber ? Colors.success : Colors.warning}>
                    <View style={styles.twoCol}>
                      <View style={{ flex: 1 }}>
                        <FormField label="Airline / Carrier" value={airlineCarrier} onChangeText={setAirlineCarrier} placeholder="e.g. Turkish Airlines" icon="flight-takeoff" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <FormField label="Flight Number" value={flightNumber} onChangeText={setFlightNumber} placeholder="e.g. TK-1234" icon="confirmation-number" mono />
                      </View>
                    </View>
                    <View style={styles.twoCol}>
                      <View style={{ flex: 1 }}>
                        <FormField label="MAWB *" value={mawbNumber} onChangeText={setMawbNumber} placeholder="235-12345678" icon="article" mono required />
                      </View>
                      <View style={{ flex: 1 }}>
                        <FormField label="HAWB" value={hawbNumber} onChangeText={setHawbNumber} placeholder="Optional" icon="article" mono />
                      </View>
                    </View>
                    <View style={styles.twoCol}>
                      <View style={{ flex: 1 }}>
                        <FormField label="Airport of Origin" value={airportOfOrigin} onChangeText={setAirportOfOrigin} placeholder="e.g. IST" icon="flight-takeoff" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <FormField label="Airport of Dest." value={airportOfDestination} onChangeText={setAirportOfDest} placeholder="e.g. BGW" icon="flight-land" />
                      </View>
                    </View>
                    <FormField label="Terminal / Handler" value={boardingTerminal} onChangeText={setBoardingTerminal} placeholder="e.g. Terminal 2, Gate B14" icon="business" />
                  </Accordion>
                )}

                {/* ── Sea Freight Accordion ── */}
                {shipmentType === 'Sea' && (
                  <Accordion icon="directions-boat" iconColor="#38BDF8" title="Sea Freight Details"
                    badge={bolNumber ? 'Filled' : 'Pending'} badgeColor={bolNumber ? Colors.success : Colors.warning}>
                    <IncotermsSelector value={incoterms} onChange={setIncoterms} />
                    <View style={styles.subDivider}>
                      <MaterialIcons name="directions-boat" size={10} color={Colors.textMuted} />
                      <Text style={styles.subDividerText}>VESSEL INFORMATION</Text>
                    </View>
                    <View style={styles.twoCol}>
                      <View style={{ flex: 1 }}>
                        <FormField label="Shipping Line" value={shippingLine} onChangeText={setShippingLine} placeholder="e.g. MSC, Maersk" icon="business" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <FormField label="Vessel Name" value={vesselName} onChangeText={setVesselName} placeholder="e.g. MSC ANNA" icon="directions-boat" />
                      </View>
                    </View>
                    <View style={styles.twoCol}>
                      <View style={{ flex: 1 }}>
                        <FormField label="Voyage No." value={voyageNumber} onChangeText={setVoyageNumber} placeholder="e.g. VY-2026-04" icon="confirmation-number" mono />
                      </View>
                      <View style={{ flex: 1 }}>
                        <FormField label="B/L Number *" value={bolNumber} onChangeText={setBolNumber} placeholder="e.g. MEDUAG012345" icon="article" mono required />
                      </View>
                    </View>
                    <View style={styles.subDivider}>
                      <MaterialIcons name="inventory-2" size={10} color={'#38BDF8'} />
                      <Text style={[styles.subDividerText, { color: '#38BDF8' }]}>CONTAINERS UNDER THIS B/L</Text>
                    </View>
                    <ContainerEditor containers={containers} onChange={setContainers} />
                    <View style={styles.subDivider}>
                      <MaterialIcons name="anchor" size={10} color={Colors.textMuted} />
                      <Text style={styles.subDividerText}>PORT INFORMATION</Text>
                    </View>
                    <Combobox label="Port of Loading" value={portOfLoading} onChangeText={setPortOfLoading}
                      presets={PRESET_PORT_OF_LOADING} placeholder="e.g. Mersin Port, TR" icon="anchor" hint="Origin port" />
                    <Combobox label="Port of Discharge" value={portOfDischarge} onChangeText={setPortOfDischarge}
                      presets={PRESET_PORT_OF_DISCHARGE} placeholder="e.g. Umm Qasr, IQ" icon="anchor" hint="Destination port" />
                    <View style={styles.subDivider}>
                      <MaterialIcons name="local-shipping" size={10} color={Colors.textMuted} />
                      <Text style={styles.subDividerText}>ARRIVAL DRIVER (PORT PICKUP)</Text>
                    </View>
                    <View style={styles.infoNote}>
                      <MaterialIcons name="info-outline" size={12} color={Colors.info} />
                      <Text style={styles.infoNoteText}>Driver who collects cargo at destination port when vessel arrives.</Text>
                    </View>
                    {arrivalDriver ? (
                      <DriverSelectedCard driver={arrivalDriver} onClear={() => setArrivalDriver(null)} />
                    ) : (
                      <PickerTrigger
                        icon="person-pin"
                        label="Assign port pickup driver (optional)"
                        onPress={() => setShowArrivalDriverPicker(true)}
                      />
                    )}
                  </Accordion>
                )}

                {/* ── Client Accordion ── */}
                <Accordion icon="business" title="Client / Customer" complete={clientComplete}
                  badge={selectedClient ? selectedClient.name : undefined} badgeColor={Colors.primary}>
                  {selectedClient ? (
                    <ClientSelectedCard client={selectedClient} onClear={() => setSelectedClient(null)} />
                  ) : (
                    <PickerTrigger icon="business" label="Select client (optional)" onPress={() => setShowClientPicker(true)} />
                  )}
                </Accordion>

                {/* ── Driver Accordion ── */}
                <Accordion icon="person" title={shipmentType === 'Road' ? 'Driver Assignment' : shipmentType === 'Sea' ? 'Agent / Forwarder' : 'Air Cargo Agent'}
                  complete={driverComplete}
                  badge={selectedDriver ? 'Assigned' : undefined} badgeColor={Colors.success}>
                  {selectedDriver ? (
                    <DriverSelectedCard driver={selectedDriver} onClear={() => setSelectedDriver(null)} />
                  ) : (
                    <PickerTrigger
                      icon="person-search"
                      label={shipmentType === 'Road' ? 'Select primary driver (optional)' : 'Select agent (optional)'}
                      onPress={() => setShowDriverPicker(true)}
                    />
                  )}
                  {shipmentType === 'Road' && (
                    <>
                      <View style={styles.subDivider}>
                        <MaterialIcons name="local-shipping" size={10} color={Colors.textMuted} />
                        <Text style={styles.subDividerText}>ADDITIONAL TRUCKS (multi-truck orders)</Text>
                      </View>
                      <AdditionalDriverEditor
                        drivers={drivers}
                        additionalDrivers={additionalDrivers}
                        primaryDriverId={selectedDriver?.id}
                        onChange={setAdditionalDrivers}
                      />
                    </>
                  )}
                </Accordion>

                {error ? <ErrorBox message={error} /> : null}

                <Pressable style={styles.nextBtn} onPress={handleNext}>
                  <Text style={styles.nextBtnText}>Next — Add Checkpoints</Text>
                  <MaterialIcons name="arrow-forward" size={18} color="#fff" />
                </Pressable>

              </View>
            ) : (
              /* STEP 2 */
              <View style={styles.form}>

                {/* ── Summary Banner ── */}
                <View style={styles.summaryBanner}>
                  <View style={[styles.summaryBannerIcon,
                    { backgroundColor: shipmentType === 'Air' ? `${Colors.info}18` : shipmentType === 'Sea' ? 'rgba(56,189,248,0.12)' : Colors.primaryGlow }]}>
                    <MaterialIcons
                      name={shipmentType === 'Air' ? 'flight' : shipmentType === 'Sea' ? 'directions-boat' : 'local-shipping'}
                      size={18}
                      color={shipmentType === 'Air' ? Colors.info : shipmentType === 'Sea' ? '#38BDF8' : Colors.primary}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.summaryBannerTir}>{tirNumber}</Text>
                    <Text style={styles.summaryBannerRoute} numberOfLines={1}>{origin} → {destination}</Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.editManifestBtn, pressed && { opacity: 0.75 }]}
                    onPress={() => setStep(1)}
                  >
                    <MaterialIcons name="edit" size={11} color={Colors.primary} />
                    <Text style={styles.editManifestBtnText}>Edit</Text>
                  </Pressable>
                </View>

                <SectionHeader icon="place" title="Transit Checkpoints" />

                <View style={styles.cpHelp}>
                  <MaterialIcons name="info-outline" size={13} color={Colors.textMuted} />
                  <Text style={styles.cpHelpText}>
                    Add stops in order.{' '}
                    <Text style={{ color: Colors.primary }}>First checkpoint</Text> is set to Current, rest to Upcoming.
                  </Text>
                </View>

                {checkpoints.map((cp, index) => (
                  <View key={cp.key} style={styles.cpCard}>
                    <View style={styles.cpCardHeader}>
                      <View style={[styles.cpBadge, index === 0 && styles.cpBadgeFirst]}>
                        <Text style={[styles.cpBadgeNum, index === 0 && styles.cpBadgeNumFirst]}>{index + 1}</Text>
                      </View>
                      <Text style={styles.cpCardTitle}>
                        {index === 0 ? 'First Checkpoint (Current)' : `Checkpoint ${index + 1}`}
                      </Text>
                      {checkpoints.length > 1 && (
                        <Pressable onPress={() => removeCheckpoint(cp.key)} hitSlop={8}>
                          <MaterialIcons name="delete-outline" size={18} color={Colors.danger} />
                        </Pressable>
                      )}
                    </View>
                    <View style={styles.cpInputGroup}>
                      <View style={styles.cpInputRow}>
                        <MaterialIcons name="label" size={14} color={Colors.textMuted} />
                        <TextInput style={styles.cpInput} value={cp.name}
                          onChangeText={v => updateCheckpoint(cp.key, 'name', v)}
                          placeholder="Checkpoint name (e.g. Habur Border Gate)"
                          placeholderTextColor={Colors.textMuted} />
                      </View>
                      <View style={[styles.cpInputRow, styles.cpInputRowLast]}>
                        <MaterialIcons name="place" size={14} color={Colors.textMuted} />
                        <TextInput style={[styles.cpInput, styles.cpInputSub]} value={cp.location}
                          onChangeText={v => updateCheckpoint(cp.key, 'location', v)}
                          placeholder="Location (e.g. Şırnak, TR)"
                          placeholderTextColor={Colors.textMuted} />
                      </View>
                    </View>
                  </View>
                ))}

                <Pressable style={styles.addCpBtn} onPress={addCheckpoint}>
                  <MaterialIcons name="add-circle-outline" size={16} color={Colors.primary} />
                  <Text style={styles.addCpBtnText}>Add Checkpoint</Text>
                </Pressable>

                {/* ── Summary card ── */}
                <SectionHeader icon="summarize" title="Shipment Summary" />
                <View style={styles.summaryCard}>
                  {[
                    { icon: 'confirmation-number' as const, label: 'Number',      value: tirNumber },
                    { icon: 'commute' as const,             label: 'Mode',        value: shipmentType },
                    { icon: 'trip-origin' as const,         label: 'Origin',      value: origin },
                    { icon: 'place' as const,               label: 'Destination', value: destination },
                    { icon: 'inventory' as const,           label: 'Cargo',       value: cargoDescription },
                    { icon: 'scale' as const,               label: 'Weight',      value: weight },
                    ...(cargoValue ? [{ icon: 'attach-money' as const, label: 'Value', value: cargoValue }] : []),
                    ...(estimatedArrival ? [{ icon: 'event' as const, label: 'ETA', value: estimatedArrival }] : []),
                    ...(agreedPrice ? [{ icon: 'handshake' as const, label: 'Price', value: agreedPrice }] : []),
                    ...(selectedClient ? [{ icon: 'business' as const, label: 'Client', value: selectedClient.name }] : []),
                    ...(selectedDriver ? [{ icon: 'person' as const, label: shipmentType === 'Road' ? 'Lead Driver' : 'Agent', value: selectedDriver.fullName }] : []),
                    ...(shipmentType === 'Road' && additionalDrivers.length > 0 ? [{ icon: 'local-shipping' as const, label: 'Fleet', value: `${additionalDrivers.length + (selectedDriver ? 1 : 0)} trucks` }] : []),
                    ...(shipmentType === 'Sea' && containers.length > 0 ? [{ icon: 'inventory-2' as const, label: 'Containers', value: `${containers.length} container${containers.length !== 1 ? 's' : ''}` }] : []),
                    ...(shipmentType === 'Sea' && incoterms ? [{ icon: 'handshake' as const, label: 'Incoterms', value: incoterms }] : []),
                    ...(shipmentType === 'Sea' && portOfLoading ? [{ icon: 'anchor' as const, label: 'Port Load', value: portOfLoading }] : []),
                    ...(shipmentType === 'Sea' && portOfDischarge ? [{ icon: 'anchor' as const, label: 'Port Disch', value: portOfDischarge }] : []),
                    ...(notes ? [{ icon: 'notes' as const, label: 'Notes', value: notes }] : []),
                  ].map((row, i, arr) => (
                    <View key={row.label} style={[styles.summaryRow, i < arr.length - 1 && styles.summaryRowBorder]}>
                      <MaterialIcons name={row.icon} size={11} color={Colors.textMuted} />
                      <Text style={styles.summaryLabel}>{row.label}</Text>
                      <Text style={styles.summaryValue} numberOfLines={1}>{row.value}</Text>
                    </View>
                  ))}
                </View>

                {error ? <ErrorBox message={error} /> : null}

                <View style={styles.actionRow}>
                  <Pressable style={styles.backBtn} onPress={() => { setStep(1); setError(''); }}>
                    <MaterialIcons name="arrow-back" size={16} color={Colors.textSecondary} />
                    <Text style={styles.backBtnText}>Back</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.saveBtn, saving && { opacity: 0.65 }]}
                    onPress={handleSave} disabled={saving}
                  >
                    {saving
                      ? <ActivityIndicator color="#fff" size="small" />
                      : (<><MaterialIcons name="rocket-launch" size={16} color="#fff" /><Text style={styles.saveBtnText}>Create Shipment</Text></>)}
                  </Pressable>
                </View>
              </View>
            )}
            <View style={{ height: 60 }} />
          </ScrollView>
        )}
      </KeyboardAvoidingView>

      {/* ── Pickers ── */}
      <Modal visible={showClientPicker} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowClientPicker(false)}>
        <PickerModal title="Select Client" subtitle={`${clients.length} clients`}
          searchValue={clientSearch} onSearchChange={setClientSearch}
          searchPlaceholder="Search by name, company, email…" onClose={() => setShowClientPicker(false)}>
          <PickerItem icon="person-off" label="No Client" sub="Skip client assignment" active={!selectedClient}
            onPress={() => { setSelectedClient(null); setShowClientPicker(false); }} />
          {filteredClients.length === 0
            ? <PickerEmpty text={clients.length === 0 ? 'No clients yet.' : 'No clients match'} />
            : filteredClients.map(client => (
              <PickerItem key={client.id}
                initials={client.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()}
                label={client.name}
                sub={[client.company, client.email].filter(Boolean).join(' · ') || 'No additional info'}
                active={selectedClient?.id === client.id}
                onPress={() => { setSelectedClient(client); setShowClientPicker(false); setClientSearch(''); }} />
            ))}
        </PickerModal>
      </Modal>

      <Modal visible={showDriverPicker} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowDriverPicker(false)}>
        <PickerModal
          title={shipmentType === 'Road' ? 'Assign Primary Driver' : 'Assign Agent'}
          subtitle={`${drivers.length} available`}
          searchValue={driverSearch} onSearchChange={setDriverSearch}
          searchPlaceholder="Search by name or plate…" onClose={() => setShowDriverPicker(false)}>
          <PickerItem icon="person-off" label="Unassigned" sub="No assignment at this time" active={!selectedDriver}
            onPress={() => { setSelectedDriver(null); setShowDriverPicker(false); }} />
          {filteredDrivers.length === 0
            ? <PickerEmpty text="No drivers match" />
            : filteredDrivers.map(driver => (
              <DriverPickerItem key={driver.id} driver={driver}
                active={selectedDriver?.id === driver.id}
                onPress={() => { setSelectedDriver(driver); setShowDriverPicker(false); setDriverSearch(''); }} />
            ))}
        </PickerModal>
      </Modal>

      <Modal visible={showArrivalDriverPicker} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowArrivalDriverPicker(false)}>
        <PickerModal title="Port Pickup Driver" subtitle="Driver who collects cargo at destination port"
          searchValue={arrivalDriverSearch} onSearchChange={setArrivalDriverSearch}
          searchPlaceholder="Search by name or plate…" onClose={() => setShowArrivalDriverPicker(false)}>
          <PickerItem icon="person-off" label="Not assigned yet" sub="Can be assigned later" active={!arrivalDriver}
            onPress={() => { setArrivalDriver(null); setShowArrivalDriverPicker(false); }} />
          {filteredArrivalDrivers.length === 0
            ? <PickerEmpty text="No drivers match" />
            : filteredArrivalDrivers.map(driver => (
              <DriverPickerItem key={driver.id} driver={driver}
                active={arrivalDriver?.id === driver.id}
                onPress={() => { setArrivalDriver(driver); setShowArrivalDriverPicker(false); setArrivalDriverSearch(''); }} />
            ))}
        </PickerModal>
      </Modal>
    </Modal>
  );
}

// ── Shared small components ───────────────────────────────────────────────────
function DriverSelectedCard({ driver, onClear }: { driver: Driver; onClear: () => void }) {
  const statusColor = driver.status === 'Active' ? Colors.success : driver.status === 'Idle' ? Colors.warning : Colors.textMuted;
  return (
    <View style={sharedSt.selectedCard}>
      <View style={sharedSt.selectedAvatar}>
        <Text style={sharedSt.selectedInitials}>{driver.avatarInitials}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={sharedSt.selectedName}>{driver.fullName}</Text>
        <Text style={sharedSt.selectedSub}>{driver.plateNumber} · {driver.truckClass}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <View style={[sharedSt.statusDot, { backgroundColor: statusColor }]} />
        <Text style={[sharedSt.statusText, { color: statusColor }]}>{driver.status}</Text>
      </View>
      <Pressable onPress={onClear} hitSlop={8} style={sharedSt.clearBtn}>
        <MaterialIcons name="close" size={14} color={Colors.textMuted} />
      </Pressable>
    </View>
  );
}

function ClientSelectedCard({ client, onClear }: { client: Client; onClear: () => void }) {
  const initials = client.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <View style={sharedSt.selectedCard}>
      <View style={[sharedSt.selectedAvatar, { backgroundColor: 'rgba(47,129,247,0.12)', borderColor: Colors.primary }]}>
        <Text style={sharedSt.selectedInitials}>{initials}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={sharedSt.selectedName}>{client.name}</Text>
        <Text style={sharedSt.selectedSub}>{[client.company, client.email].filter(Boolean).join(' · ') || 'No additional info'}</Text>
      </View>
      <Pressable onPress={onClear} hitSlop={8} style={sharedSt.clearBtn}>
        <MaterialIcons name="close" size={14} color={Colors.textMuted} />
      </Pressable>
    </View>
  );
}

function PickerTrigger({ icon, label, onPress }: { icon: keyof typeof MaterialIcons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [sharedSt.pickerTrigger, pressed && { opacity: 0.8 }]} onPress={onPress}>
      <MaterialIcons name={icon} size={18} color={Colors.textMuted} />
      <Text style={sharedSt.pickerTriggerText}>{label}</Text>
      <MaterialIcons name="chevron-right" size={18} color={Colors.textMuted} />
    </Pressable>
  );
}

const sharedSt = StyleSheet.create({
  selectedCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1.5, borderColor: Colors.primary, padding: Spacing.md,
    ...Shadow.card,
  },
  selectedAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  selectedInitials: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  selectedName: { fontSize: FontSize.base, fontWeight: '600', color: Colors.textPrimary },
  selectedSub: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: FontSize.xs, fontWeight: '600' },
  clearBtn: { padding: 4 },
  pickerTrigger: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed',
    padding: Spacing.lg, minHeight: 52,
  },
  pickerTriggerText: { flex: 1, fontSize: FontSize.base, color: Colors.textMuted },
});

// ── Picker Modal Wrapper ──────────────────────────────────────────────────────
function PickerModal({ title, subtitle, searchValue, onSearchChange, searchPlaceholder, onClose, children }: {
  title: string; subtitle: string; searchValue: string;
  onSearchChange: (v: string) => void; searchPlaceholder: string;
  onClose: () => void; children: React.ReactNode;
}) {
  return (
    <View style={pmStyles.root}>
      <View style={pmStyles.header}>
        <View>
          <Text style={pmStyles.title}>{title}</Text>
          <Text style={pmStyles.sub}>{subtitle}</Text>
        </View>
        <Pressable onPress={onClose} style={pmStyles.closeBtn}>
          <MaterialIcons name="close" size={18} color={Colors.textSecondary} />
        </Pressable>
      </View>
      <View style={pmStyles.search}>
        <MaterialIcons name="search" size={16} color={Colors.textMuted} />
        <TextInput style={pmStyles.searchInput} value={searchValue} onChangeText={onSearchChange}
          placeholder={searchPlaceholder} placeholderTextColor={Colors.textMuted} autoCapitalize="none" />
        {searchValue ? <Pressable onPress={() => onSearchChange('')}><MaterialIcons name="close" size={14} color={Colors.textMuted} /></Pressable> : null}
      </View>
      <ScrollView showsVerticalScrollIndicator={false}>{children}</ScrollView>
    </View>
  );
}

function PickerItem({ icon, initials, label, sub, active, onPress }: {
  icon?: keyof typeof MaterialIcons.glyphMap; initials?: string;
  label: string; sub: string; active?: boolean; onPress: () => void;
}) {
  return (
    <Pressable style={({ pressed }) => [pmStyles.item, active && pmStyles.itemActive, pressed && { opacity: 0.75 }]} onPress={onPress}>
      <View style={pmStyles.avatar}>
        {icon ? <MaterialIcons name={icon} size={18} color={Colors.textMuted} /> : <Text style={pmStyles.avatarText}>{initials}</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={pmStyles.name}>{label}</Text>
        <Text style={pmStyles.meta}>{sub}</Text>
      </View>
      {active && <MaterialIcons name="check-circle" size={18} color={Colors.primary} />}
    </Pressable>
  );
}

function DriverPickerItem({ driver, active, onPress }: { driver: Driver; active: boolean; onPress: () => void }) {
  const statusColor = driver.status === 'Active' ? Colors.success : driver.status === 'Idle' ? Colors.warning : Colors.textMuted;
  return (
    <Pressable style={({ pressed }) => [pmStyles.item, active && pmStyles.itemActive, pressed && { opacity: 0.75 }]} onPress={onPress}>
      <View style={pmStyles.avatar}><Text style={pmStyles.avatarText}>{driver.avatarInitials}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={pmStyles.name}>{driver.fullName}</Text>
        <Text style={pmStyles.meta}>{driver.plateNumber} · {driver.truckClass}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor }} />
        <Text style={[pmStyles.statusText, { color: statusColor }]}>{driver.status}</Text>
      </View>
      {active && <MaterialIcons name="check-circle" size={18} color={Colors.primary} />}
    </Pressable>
  );
}

function PickerEmpty({ text }: { text: string }) {
  return (
    <View style={pmStyles.empty}>
      <MaterialIcons name="search-off" size={32} color={Colors.border} />
      <Text style={pmStyles.emptyText}>{text}</Text>
    </View>
  );
}

function SectionHeader({ icon, title }: { icon: keyof typeof MaterialIcons.glyphMap; title: string }) {
  return (
    <View style={secStyles.row}>
      <View style={secStyles.iconWrap}><MaterialIcons name={icon} size={13} color={Colors.primary} /></View>
      <Text style={secStyles.title}>{title.toUpperCase()}</Text>
      <View style={secStyles.line} />
    </View>
  );
}

interface FormFieldProps {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder: string; icon: keyof typeof MaterialIcons.glyphMap;
  mono?: boolean; keyboard?: 'default' | 'numeric' | 'email-address' | 'phone-pad';
  required?: boolean; hint?: string;
}
function FormField({ label, value, onChangeText, placeholder, icon, mono, keyboard, required, hint }: FormFieldProps) {
  return (
    <View style={ffStyles.wrap}>
      <View style={ffStyles.labelRow}>
        <Text style={ffStyles.label}>{label}{required ? '' : ''}</Text>
        {hint ? <Text style={ffStyles.hint}>{hint}</Text> : null}
      </View>
      <View style={ffStyles.inputRow}>
        <MaterialIcons name={icon} size={15} color={Colors.textMuted} />
        <TextInput
          style={[ffStyles.input, mono && { fontFamily: 'monospace' }]}
          value={value} onChangeText={onChangeText}
          placeholder={placeholder} placeholderTextColor={Colors.textMuted}
          autoCapitalize="none" keyboardType={keyboard ?? 'default'}
        />
        {value ? (
          <Pressable onPress={() => onChangeText('')} hitSlop={8}>
            <MaterialIcons name="close" size={13} color={Colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <View style={errStyles.wrap}>
      <MaterialIcons name="error-outline" size={14} color={Colors.danger} />
      <Text style={errStyles.text}>{message}</Text>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl, paddingBottom: Spacing.lg,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headerIcon: {
    width: 40, height: 40, borderRadius: BorderRadius.md,
    backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  headerSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2, fontFamily: 'monospace' },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  progressBar: { height: 3, backgroundColor: Colors.border },
  progressFill: { height: 3, backgroundColor: Colors.primary, borderRadius: 2 },
  stepsRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, gap: 36,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
    backgroundColor: Colors.surface,
  },
  stepItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepCircle: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  stepCircleActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  stepNum: { fontSize: 11, fontWeight: '700', color: Colors.textMuted },
  stepLabel: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '500' },
  stepLabelActive: { color: Colors.textPrimary, fontWeight: '600' },
  scroll: { flex: 1 },
  form: { padding: Spacing.xl, gap: Spacing.md },

  // Transport mode
  transportSection: { gap: Spacing.sm },
  transportLabel: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.9 },
  transportModeRow: { flexDirection: 'row', gap: Spacing.sm },
  transportBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1.5, borderColor: Colors.border,
    paddingVertical: 14, position: 'relative', overflow: 'hidden',
  },
  transportBtnAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  transportBtnLabel: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textMuted },
  transportBtnSub: { fontSize: 9, color: Colors.textMuted, fontWeight: '500' },
  transportCheck: {
    position: 'absolute', top: 8, right: 8,
    width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
  },

  // ETR row
  tirRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.lg, paddingVertical: 10,
  },
  tirLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tirAutoLabel: { fontSize: FontSize.xs, color: Colors.textMuted, fontWeight: '500' },
  tirRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  tirValue: { fontSize: FontSize.base, fontWeight: '700', color: Colors.primary, fontFamily: 'monospace', letterSpacing: 0.5 },
  regenBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },

  twoCol: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  routeArrow: { marginTop: 30, paddingTop: 4, alignItems: 'center', justifyContent: 'center' },

  subDivider: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: Spacing.xs },
  subDividerText: { fontSize: 9, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.9 },

  infoNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: Colors.infoBg, borderRadius: BorderRadius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: `${Colors.info}25`,
  },
  infoNoteText: { flex: 1, fontSize: FontSize.xs, color: Colors.textSecondary, lineHeight: 17 },

  notesWrap: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  notesLabelRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: 4,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  notesLabel: { flex: 1, fontSize: FontSize.xs, fontWeight: '600', color: Colors.textMuted, letterSpacing: 0.3 },
  notesHint: { fontSize: 10, color: Colors.textMuted, fontStyle: 'italic' },
  notesInput: {
    fontSize: FontSize.sm, color: Colors.textPrimary,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    minHeight: 70, lineHeight: 22,
  },

  // Step 2
  summaryBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    padding: Spacing.lg,
  },
  summaryBannerIcon: {
    width: 44, height: 44, borderRadius: BorderRadius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  summaryBannerTir: { fontSize: FontSize.base, fontWeight: '800', color: Colors.primary, fontFamily: 'monospace' },
  summaryBannerRoute: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  editManifestBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.full,
    paddingHorizontal: 9, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
  },
  editManifestBtnText: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '600' },

  cpHelp: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  cpHelpText: { fontSize: FontSize.xs, color: Colors.textMuted, flex: 1, lineHeight: 18 },
  cpCard: { backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  cpCardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  cpBadge: { width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.surface, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  cpBadgeFirst: { backgroundColor: Colors.primaryGlow, borderColor: Colors.primary },
  cpBadgeNum: { fontSize: 11, fontWeight: '700', color: Colors.textMuted },
  cpBadgeNumFirst: { color: Colors.primary },
  cpCardTitle: { flex: 1, fontSize: FontSize.xs, fontWeight: '600', color: Colors.textSecondary },
  cpInputGroup: { borderTopWidth: 1, borderTopColor: Colors.borderSubtle },
  cpInputRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  cpInputRowLast: { borderBottomWidth: 0 },
  cpInput: { flex: 1, fontSize: FontSize.base, color: Colors.textPrimary },
  cpInputSub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  addCpBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.25)', paddingVertical: 12,
  },
  addCpBtnText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },

  summaryCard: { backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: 10 },
  summaryRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  summaryLabel: { fontSize: FontSize.xs, color: Colors.textMuted, width: 90 },
  summaryValue: { flex: 1, fontSize: FontSize.sm, fontWeight: '600', color: Colors.textPrimary },

  actionRow: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xs },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.card, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, paddingVertical: 13, paddingHorizontal: Spacing.lg },
  backBtnText: { fontSize: FontSize.base, color: Colors.textSecondary, fontWeight: '500' },
  nextBtn: { backgroundColor: Colors.primary, borderRadius: BorderRadius.md, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: Spacing.sm },
  nextBtnText: { color: '#fff', fontSize: FontSize.base, fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: Colors.success, borderRadius: BorderRadius.md, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  saveBtnText: { color: '#fff', fontSize: FontSize.base, fontWeight: '600' },
});

const cbStyles = StyleSheet.create({
  wrap: { gap: Spacing.xs },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: FontSize.sm, fontWeight: '500', color: Colors.textSecondary },
  hint: { fontSize: 10, color: Colors.textMuted, fontStyle: 'italic' },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, minHeight: 44,
  },
  inputRowFocused: { borderColor: Colors.primary },
  input: { flex: 1, fontSize: FontSize.base, color: Colors.textPrimary, paddingVertical: 10 },
  suggestions: { backgroundColor: Colors.card, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, paddingVertical: Spacing.sm, overflow: 'hidden' },
  chip: { backgroundColor: Colors.surface, borderRadius: BorderRadius.full, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '500' },
});

const incStyles = StyleSheet.create({
  wrap: { gap: Spacing.xs },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: FontSize.sm, fontWeight: '500', color: Colors.textSecondary },
  badge: { backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.full, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: 'rgba(47,129,247,0.25)' },
  badgeText: { fontSize: 9, color: Colors.primary, fontWeight: '700', letterSpacing: 0.5 },
  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, minHeight: 44,
  },
  triggerText: { flex: 1, fontSize: FontSize.base, color: Colors.textMuted },
  selected: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.md,
    borderWidth: 1.5, borderColor: Colors.primary, padding: Spacing.md,
  },
  selectedLeft: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  codeChip: { backgroundColor: Colors.primary, borderRadius: BorderRadius.sm, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start', flexShrink: 0 },
  codeChipText: { fontSize: FontSize.sm, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
  selectedLabel: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textPrimary },
  selectedDesc: { fontSize: FontSize.xs, color: Colors.textSecondary, lineHeight: 17, marginTop: 2 },
  clearBtn: { padding: 4 },
  list: { backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  termItem: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingVertical: 11 },
  termBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  termCode: { backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.sm, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)', flexShrink: 0, minWidth: 46, alignItems: 'center' },
  termCodeText: { fontSize: FontSize.xs, fontWeight: '800', color: Colors.primary },
  termLabel: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textPrimary },
  termDesc: { fontSize: FontSize.xs, color: Colors.textMuted, lineHeight: 17, marginTop: 2 },
});

const ctSt = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { fontSize: 11, fontWeight: '700', color: '#38BDF8', letterSpacing: 0.8 },
  countPill: {
    backgroundColor: 'rgba(56,189,248,0.15)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(56,189,248,0.3)',
  },
  countText: { fontSize: 10, fontWeight: '700', color: '#38BDF8' },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.full,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
  },
  addBtnText: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.primary },
  emptyCard: {
    alignItems: 'center', gap: 5, paddingVertical: Spacing.lg,
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed',
  },
  emptyText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textMuted },
  emptySubText: { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center' },
  card: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: 'rgba(56,189,248,0.2)', overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: 'rgba(56,189,248,0.06)',
    paddingHorizontal: Spacing.md, paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: 'rgba(56,189,248,0.15)',
  },
  cardIndexBadge: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(56,189,248,0.2)', borderWidth: 1, borderColor: 'rgba(56,189,248,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  cardIndexText: { fontSize: 10, fontWeight: '800', color: '#38BDF8' },
  cardTitle: { flex: 1, fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  fieldInput: { flex: 1, fontSize: FontSize.sm, color: Colors.textPrimary },
  twoFieldRow: { flexDirection: 'row' },
  chipsSection: { paddingHorizontal: Spacing.md, paddingVertical: 8, gap: 4 },
  chipLabel: { fontSize: 9, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.8 },
  chipsRow: { flexDirection: 'row', gap: 6 },
  chip: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.full,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.border,
  },
  chipActive: { backgroundColor: 'rgba(56,189,248,0.15)', borderColor: 'rgba(56,189,248,0.4)' },
  chipText: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: '#38BDF8', fontWeight: '700' },
});

const adSt = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.8 },
  countPill: {
    backgroundColor: Colors.primaryGlow, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
  },
  countText: { fontSize: 10, fontWeight: '700', color: Colors.primary },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.full,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
  },
  addBtnText: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.primary },
  empty: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  emptyText: { fontSize: FontSize.xs, color: Colors.textMuted },
  driverCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingVertical: 10,
  },
  driverAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  driverAvatarText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  driverNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  truckNumBadge: {
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.full,
    paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
  },
  truckNumText: { fontSize: 9, fontWeight: '700', color: Colors.primary },
  driverName: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textPrimary, flex: 1 },
  driverMeta: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2, fontFamily: 'monospace' },
});

const secStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  iconWrap: { width: 22, height: 22, borderRadius: BorderRadius.sm, backgroundColor: Colors.primaryGlow, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 1 },
  line: { flex: 1, height: 1, backgroundColor: Colors.borderSubtle },
});

const ffStyles = StyleSheet.create({
  wrap: { gap: Spacing.xs },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: FontSize.sm, fontWeight: '500', color: Colors.textSecondary },
  hint: { fontSize: 10, color: Colors.textMuted, fontStyle: 'italic' },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, minHeight: 44,
  },
  input: { flex: 1, fontSize: FontSize.base, color: Colors.textPrimary, paddingVertical: 10 },
});

const errStyles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.md, padding: Spacing.md, borderWidth: 1, borderColor: 'rgba(248,81,73,0.25)' },
  text: { fontSize: FontSize.sm, color: Colors.danger, flex: 1 },
});

const pmStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.xl, borderBottomWidth: 1, borderBottomColor: Colors.border },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.textPrimary },
  sub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  search: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, margin: Spacing.xl, marginBottom: Spacing.md, backgroundColor: Colors.card, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md, height: 44 },
  searchInput: { flex: 1, fontSize: FontSize.base, color: Colors.textPrimary },
  item: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  itemActive: { backgroundColor: Colors.primaryGlow },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  name: { fontSize: FontSize.base, fontWeight: '600', color: Colors.textPrimary },
  meta: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  statusText: { fontSize: FontSize.xs, fontWeight: '600' },
  empty: { alignItems: 'center', padding: 40, gap: Spacing.md },
  emptyText: { color: Colors.textMuted, fontSize: FontSize.base },
});
