import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Platform, Share, Linking, Modal, ActivityIndicator, TextInput, Dimensions } from 'react-native';

// Compute doc thumbnail width from screen — avoids '31.5%' string crash on iOS native
const SCREEN_W = Dimensions.get('window').width;
const DOC_THUMB_W = Math.floor((SCREEN_W - 40 * 2 - 8 * 2) / 3); // 3 per row, 40px padding each side, 8px gaps
// DateTimePicker is only available on native — lazy require with try-catch to prevent crashes
let DateTimePicker: any = null;
if (Platform.OS !== 'web') {
  try {
    DateTimePicker = require('@react-native-community/datetimepicker').default;
  } catch (e) {
    // Package not available in this build — ETA picker will fall back to text display
  }
}
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
// LiveMap requires react-native-maps which is only available in native builds.
// Lazy-require with try-catch to prevent crash in Expo Go.
let LiveMapComponent: typeof import('@/components/feature/LiveMap').LiveMap | null = null;
try {
  LiveMapComponent = require('@/components/feature/LiveMap').LiveMap;
} catch (e) {
  // Map unavailable (Expo Go or web fallback)
}
import { Shipment, ShipmentStatus, Driver } from '@/types';
import { useDrivers } from '@/hooks/useDrivers';
// SeaTrackingMap is lazily required — only loaded when a Sea shipment is actually rendered
// This prevents react-native-maps from being pulled in when ShipmentDetail is imported
let _SeaTrackingMap: React.ComponentType<any> | null = null;
function getLazySeaTrackingMap() {
  if (!_SeaTrackingMap) {
    try { _SeaTrackingMap = require('@/components/feature/SeaTrackingMap').SeaTrackingMap; }
    catch { _SeaTrackingMap = null; }
  }
  return _SeaTrackingMap;
}
import { StatusBadge } from '@/components/ui/StatusBadge';
import { CheckpointProgress } from '@/components/ui/CheckpointProgress';
import { fetchShipmentDocuments, deleteCargoDocument, CargoDocument } from '@/services/documentService';
import { supabase } from '@/services/supabaseClient';
import { fetchLocationHistory, LocationPoint } from '@/services/locationHistoryService';
import { ShipmentChat } from '@/components/feature/ShipmentChat';
import { Colors, FontSize, Spacing, BorderRadius, Shadow } from '@/constants/theme';

type StatusOption = { value: ShipmentStatus; label: string; color: string; icon: keyof typeof MaterialIcons.glyphMap };

const ROAD_STATUS_OPTIONS: StatusOption[] = [
  { value: 'Loaded',            label: 'Loaded',            color: '#79C0FF',        icon: 'inventory' },
  { value: 'Dispatched',        label: 'Dispatched',        color: '#D2A8FF',        icon: 'local-shipping' },
  { value: 'In Transit',        label: 'In Transit',        color: Colors.primary,   icon: 'directions-car' },
  { value: 'Border Crossing',   label: 'Border Crossing',   color: '#D2A8FF',        icon: 'swap-horiz' },
  { value: 'Customs Clearance', label: 'Customs Clearance', color: Colors.warning,   icon: 'verified-user' },
  { value: 'Customs Pending',   label: 'Customs Pending',   color: Colors.warning,   icon: 'pending-actions' },
  { value: 'Arrived',           label: 'Arrived',           color: Colors.success,   icon: 'check-circle' },
  { value: 'Detained',          label: 'Detained',          color: Colors.danger,    icon: 'block' },
];

const SEA_STATUS_OPTIONS: StatusOption[] = [
  { value: 'Booked',                label: 'Booked',                color: '#38BDF8',        icon: 'bookmark' },
  { value: 'Loaded',                label: 'Loaded / Stuffed',      color: '#79C0FF',        icon: 'inventory' },
  { value: 'At Port of Loading',    label: 'At Port of Loading',    color: '#818CF8',        icon: 'anchor' },
  { value: 'Vessel Departed',       label: 'Vessel Departed',       color: '#0EA5E9',        icon: 'directions-boat' },
  { value: 'At Sea',                label: 'At Sea',                color: Colors.primary,   icon: 'water' },
  { value: 'At Port of Discharge',  label: 'At Port of Discharge',  color: '#818CF8',        icon: 'anchor' },
  { value: 'Port Customs',          label: 'Port Customs',          color: Colors.warning,   icon: 'verified-user' },
  { value: 'Customs Pending',       label: 'Customs Pending',       color: Colors.warning,   icon: 'pending-actions' },
  { value: 'Arrived',               label: 'Arrived / Delivered',   color: Colors.success,   icon: 'check-circle' },
  { value: 'Detained',              label: 'Detained',              color: Colors.danger,    icon: 'block' },
];

const AIR_STATUS_OPTIONS: StatusOption[] = [
  { value: 'Loaded',            label: 'Loaded / Ready',      color: '#79C0FF',        icon: 'inventory' },
  { value: 'Awaiting Flight',   label: 'Awaiting Flight',     color: '#7DD3FC',        icon: 'schedule' },
  { value: 'Dispatched',        label: 'Dispatched to Airport', color: '#D2A8FF',      icon: 'local-shipping' },
  { value: 'In Flight',         label: 'In Flight',           color: '#38BDF8',        icon: 'flight' },
  { value: 'Arrived at Hub',    label: 'Arrived at Hub',      color: '#34D399',        icon: 'flight-land' },
  { value: 'Customs Clearance', label: 'Customs Clearance',   color: Colors.warning,   icon: 'verified-user' },
  { value: 'Customs Pending',   label: 'Customs Pending',     color: Colors.warning,   icon: 'pending-actions' },
  { value: 'Arrived',           label: 'Arrived / Delivered', color: Colors.success,   icon: 'check-circle' },
  { value: 'Detained',          label: 'Detained',            color: Colors.danger,    icon: 'block' },
];

function getStatusOptions(shipmentType?: string): StatusOption[] {
  if (shipmentType === 'Sea') return SEA_STATUS_OPTIONS;
  if (shipmentType === 'Air') return AIR_STATUS_OPTIONS;
  return ROAD_STATUS_OPTIONS;
}

interface Props {
  shipment: Shipment;
  onClose: () => void;
  onStatusChange?: (id: string, status: ShipmentStatus) => Promise<void>;
  onDriverAssign?: (id: string, driverId: string | null, driverName: string, plateNumber: string) => Promise<void>;
  onETAChange?: (id: string, estimatedArrival: string) => Promise<void>;
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, mono && styles.mono]}>{value}</Text>
    </View>
  );
}

export function ShipmentDetail({ shipment, onClose, onStatusChange, onDriverAssign, onETAChange }: Props) {
  const { drivers } = useDrivers();
  const [copied, setCopied] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [showDriverPicker, setShowDriverPicker] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [updatingDriver, setUpdatingDriver] = useState(false);
  const [localStatus, setLocalStatus] = useState<ShipmentStatus>(shipment.status);
  const [localDriverName, setLocalDriverName] = useState(shipment.driverName);
  const [localPlate, setLocalPlate] = useState(shipment.plateNumber);
  const [localETA, setLocalETA] = useState(shipment.estimatedArrival);
  const [showETAPicker, setShowETAPicker] = useState(false);
  const [updatingETA, setUpdatingETA] = useState(false);
  const [driverSearch, setDriverSearch] = useState('');
  // Agreed price local state
  const [localPriceAccepted, setLocalPriceAccepted] = useState(shipment.priceAccepted ?? false);
  const [localPriceAcceptedAt, setLocalPriceAcceptedAt] = useState(shipment.priceAcceptedAt);

  // ── Container edit state ──────────────────────────────────────────────
  const [showContainerEditor, setShowContainerEditor] = useState(false);
  const [editContainers, setEditContainers] = useState<(ContainerEntry & { _key: string })[]>([]);
  const [savingContainers, setSavingContainers] = useState(false);
  const [containerSaveError, setContainerSaveError] = useState('');

  const openContainerEditor = () => {
    const current = (shipment.containers ?? []).map((c, i) => ({ ...c, _key: `${i}-${Math.random().toString(36).slice(2, 7)}` }));
    setEditContainers(current.length > 0 ? current : []);
    setContainerSaveError('');
    setShowContainerEditor(true);
  };

  const addEditContainer = () => {
    setEditContainers(prev => [...prev, { _key: Math.random().toString(36).slice(2, 8), container_number: '', seal_number: '', size: '20ft', type: 'Dry', weight: '' }]);
  };

  const removeEditContainer = (_key: string) => {
    setEditContainers(prev => prev.filter(c => c._key !== _key));
  };

  const updateEditContainer = (_key: string, field: keyof ContainerEntry, val: string) => {
    setEditContainers(prev => prev.map(c => c._key === _key ? { ...c, [field]: val } : c));
  };

  const saveContainers = async () => {
    setSavingContainers(true);
    setContainerSaveError('');
    const payload = editContainers.map(({ _key: _k, ...rest }) => rest);
    const { error } = await supabase
      .from('shipments')
      .update({ containers: payload, updated_at: new Date().toISOString() })
      .eq('id', shipment.id);
    setSavingContainers(false);
    if (error) { setContainerSaveError(error.message); return; }
    // Optimistically reflect in local prop via status change path
    shipment.containers = payload;
    setShowContainerEditor(false);
  };

  // ── Route History state ─────────────────────────────────────────────────
  const [routeHistory, setRouteHistory] = useState<LocationPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [showHistoryMap, setShowHistoryMap] = useState(false);

  // ── Documents state ───────────────────────────────────────────────────────
  const [documents, setDocuments] = useState<CargoDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [lightboxDoc, setLightboxDoc] = useState<CargoDocument | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // Fetch route history
  useEffect(() => {
    setHistoryLoading(true);
    fetchLocationHistory(shipment.id).then(({ points }) => {
      setRouteHistory(points);
      setHistoryLoading(false);
    });
  }, [shipment.id]);

  useEffect(() => {
    setDocsLoading(true);
    fetchShipmentDocuments(shipment.id).then(({ docs }) => {
      setDocuments(docs);
      setDocsLoading(false);
    });
  }, [shipment.id]);

  const handleDeleteDoc = useCallback((docId: string) => {
    deleteCargoDocument(docId).then(() => {
      setDocuments(prev => prev.filter(d => d.id !== docId));
      if (lightboxDoc?.id === docId) setLightboxDoc(null);
    });
  }, [lightboxDoc]);

  const openLightbox = (doc: CargoDocument, index: number) => {
    setLightboxDoc(doc);
    setLightboxIndex(index);
  };

  const navigateLightbox = (dir: 1 | -1) => {
    const next = lightboxIndex + dir;
    if (next < 0 || next >= documents.length) return;
    setLightboxDoc(documents[next]);
    setLightboxIndex(next);
  };

  const handleStatusChange = async (status: ShipmentStatus) => {
    if (status === localStatus || !onStatusChange) return;
    setUpdatingStatus(true);
    setShowStatusPicker(false);
    await onStatusChange(shipment.id, status);
    setLocalStatus(status);
    setUpdatingStatus(false);
  };

  const handleDriverAssign = async (driver: Driver | null) => {
    if (!onDriverAssign) return;
    setUpdatingDriver(true);
    setShowDriverPicker(false);
    setDriverSearch('');
    const driverId = driver?.id ?? null;
    const driverName = driver?.fullName ?? 'Unassigned';
    const plateNumber = driver?.plateNumber ?? '--';
    await onDriverAssign(shipment.id, driverId, driverName, plateNumber);
    setLocalDriverName(driverName);
    setLocalPlate(plateNumber);
    setUpdatingDriver(false);
  };

  const handleETAChange = async (date: Date | undefined) => {
    if (Platform.OS !== 'web') setShowETAPicker(false);
    if (!date || !onETAChange) return;
    const formatted = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    setUpdatingETA(true);
    await onETAChange(shipment.id, formatted);
    setLocalETA(formatted);
    setUpdatingETA(false);
  };

  const handleETAPress = () => {
    if (!onETAChange) return;
    if (Platform.OS === 'web') {
      setShowETAPicker(v => !v);
    } else {
      setShowETAPicker(true);
    }
  };

  const parsedDate = (() => {
    try { return new Date(localETA); } catch { return new Date(); }
  })();
  const dateValue = isNaN(parsedDate.getTime()) ? new Date() : parsedDate;

  const filteredDrivers = drivers.filter(d =>
    !driverSearch.trim() ||
    d.fullName.toLowerCase().includes(driverSearch.toLowerCase()) ||
    d.plateNumber.toLowerCase().includes(driverSearch.toLowerCase())
  );

  const STATUS_OPTIONS = getStatusOptions(shipment.shipmentType);
  const currentOption = STATUS_OPTIONS.find(o => o.value === localStatus);

  const handleEmailCustomer = () => {
    const trackingUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/tracking?number=${encodeURIComponent(shipment.tirNumber)}`
      : `/tracking?number=${encodeURIComponent(shipment.tirNumber)}`;

    const subject = encodeURIComponent(
      `Your MARAS Shipment Update — ${shipment.tirNumber}`
    );
    const body = encodeURIComponent(
      `Dear Customer,\n\n` +
      `Your shipment is currently on its way. Here is a summary:\n\n` +
      `  Shipment No.  : ${shipment.tirNumber}\n` +
      `  Route         : ${shipment.origin} → ${shipment.destination}\n` +
      `  Status        : ${shipment.status}\n` +
      `  Est. Arrival  : ${shipment.estimatedArrival}\n` +
      `  Driver        : ${shipment.driverName} (${shipment.plateNumber})\n\n` +
      `Track your shipment in real time here:\n${trackingUrl}\n\n` +
      `If you have any questions, please contact MARAS dispatch.\n\n` +
      `Best regards,\nMAR Group Logistics`
    );

    Linking.openURL(`mailto:?subject=${subject}&body=${body}`);
    setEmailSent(true);
    setTimeout(() => setEmailSent(false), 3000);
  };

  const handleShareLink = async () => {
    const trackingUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/tracking?number=${encodeURIComponent(shipment.tirNumber)}`
      : `/tracking?number=${encodeURIComponent(shipment.tirNumber)}`;
    if (Platform.OS === 'web') {
      try { await navigator.clipboard.writeText(trackingUrl); } catch {}
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } else {
      await Share.share({ message: `Track shipment ${shipment.tirNumber}: ${trackingUrl}`, url: trackingUrl });
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.modalHeader}>
        <View>
          <Text style={styles.modalTitle}>Shipment Detail</Text>
          <Text style={styles.modalSubtitle}>{shipment.tirNumber}</Text>
        </View>
        <Pressable style={styles.closeBtn} onPress={onClose}>
          <MaterialIcons name="close" size={20} color={Colors.textSecondary} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
        <View style={styles.section}>
          <View style={styles.statusShareRow}>
            <View style={styles.statusLeft}>
              <StatusBadge status={localStatus} />
              {onStatusChange && (
                <Pressable
                  style={({ pressed }) => [styles.statusChangeBtn, pressed && { opacity: 0.75 }, updatingStatus && { opacity: 0.5 }]}
                  onPress={() => setShowStatusPicker(true)}
                  disabled={updatingStatus}
                >
                  {updatingStatus ? (
                    <ActivityIndicator size="small" color={Colors.primary} />
                  ) : (
                    <>
                      <MaterialIcons name="edit" size={11} color={Colors.primary} />
                      <Text style={styles.statusChangeBtnText}>Change</Text>
                    </>
                  )}
                </Pressable>
              )}
            </View>
            <View style={styles.actionBtns}>
              <Pressable
                style={({ pressed }) => [styles.actionBtn, styles.emailBtn, pressed && { opacity: 0.8 }, emailSent && styles.emailBtnSent]}
                onPress={handleEmailCustomer}
              >
                <MaterialIcons
                  name={emailSent ? 'check' : 'email'}
                  size={13}
                  color={emailSent ? Colors.success : Colors.warning}
                />
                <Text style={[styles.actionBtnText, styles.emailBtnText, emailSent && styles.emailBtnTextSent]}>
                  {emailSent ? 'Opened!' : 'Email'}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.actionBtn, styles.shareBtn, pressed && { opacity: 0.8 }, copied && styles.shareBtnCopied]}
                onPress={handleShareLink}
              >
                <MaterialIcons
                  name={copied ? 'check' : 'link'}
                  size={13}
                  color={copied ? Colors.success : Colors.primary}
                />
                <Text style={[styles.actionBtnText, styles.shareBtnText, copied && styles.shareBtnTextCopied]}>
                  {copied ? 'Copied!' : 'Link'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Route</Text>
          <View style={styles.routeCard}>
            <View style={styles.routeItem}>
              <View style={[styles.routeCircle, { borderColor: Colors.primary }]}>
                <View style={[styles.routeInner, { backgroundColor: Colors.primary }]} />
              </View>
              <View>
                <Text style={styles.routeLabel}>Origin</Text>
                <Text style={styles.routeValue}>{shipment.origin}</Text>
              </View>
            </View>
            <View style={[styles.routeConnector, { borderColor: Colors.border }]} />
            <View style={styles.routeItem}>
              <View style={[styles.routeCircle, { borderColor: Colors.success }]}>
                <View style={[styles.routeInner, { backgroundColor: Colors.success }]} />
              </View>
              <View>
                <Text style={styles.routeLabel}>Destination</Text>
                <Text style={styles.routeValue}>{shipment.destination}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cargo Information</Text>
          <View style={styles.infoCard}>
            <InfoRow label="Description" value={shipment.cargoDescription} />
            <InfoRow label="Weight" value={shipment.weight} />
            <InfoRow label="Shipment No." value={shipment.tirNumber} mono />
            {/* Client info */}
            {shipment.clientName ? (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Client</Text>
                <View style={styles.transportModeRow}>
                  <MaterialIcons name="business" size={13} color={Colors.primary} />
                  <Text style={[styles.infoValue, { color: Colors.textPrimary }]}>{shipment.clientName}</Text>
                </View>
              </View>
            ) : null}
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Transport Mode</Text>
              <View style={styles.transportModeRow}>
                <MaterialIcons
                  name={shipment.shipmentType === 'Air' ? 'flight' : shipment.shipmentType === 'Sea' ? 'directions-boat' : 'local-shipping'}
                  size={13}
                  color={shipment.shipmentType === 'Air' ? Colors.info : shipment.shipmentType === 'Sea' ? Colors.primary : Colors.textSecondary}
                />
                <Text style={[styles.infoValue, { color: shipment.shipmentType === 'Air' ? Colors.info : shipment.shipmentType === 'Sea' ? Colors.primary : Colors.textSecondary, fontWeight: '700' }]}>
                  {shipment.shipmentType ?? 'Road'}
                </Text>
              </View>
            </View>
            {/* ── Air freight details ───────────────────────────────────────── */}
            {shipment.shipmentType === 'Air' && (
              <>
                <View style={styles.typeDetailDivider}>
                  <MaterialIcons name="flight" size={12} color={Colors.info} />
                  <Text style={[styles.typeDetailLabel, { color: Colors.info }]}>AIR FREIGHT DETAILS</Text>
                  <View style={[styles.typeDetailLine, { backgroundColor: `${Colors.info}25` }]} />
                </View>
                {shipment.airlineCarrier   && <InfoRow label="Airline / Carrier"       value={shipment.airlineCarrier} />}
                {shipment.flightNumber     && <InfoRow label="Flight Number"           value={shipment.flightNumber} mono />}
                {shipment.mawbNumber       && <InfoRow label="MAWB Number"             value={shipment.mawbNumber} mono />}
                {shipment.hawbNumber       && <InfoRow label="HAWB Number"             value={shipment.hawbNumber} mono />}
                {shipment.airportOfOrigin  && <InfoRow label="Airport of Origin"       value={shipment.airportOfOrigin} />}
                {shipment.airportOfDestination && <InfoRow label="Airport of Dest."    value={shipment.airportOfDestination} />}
                {shipment.boardingTerminal && <InfoRow label="Terminal / Handler"      value={shipment.boardingTerminal} />}
              </>
            )}
            {/* ── Sea freight details ───────────────────────────────────────── */}
            {shipment.shipmentType === 'Sea' && (
              <>
                <View style={styles.typeDetailDivider}>
                  <MaterialIcons name="directions-boat" size={12} color={Colors.primary} />
                  <Text style={[styles.typeDetailLabel, { color: Colors.primary }]}>SEA FREIGHT DETAILS</Text>
                  <View style={[styles.typeDetailLine, { backgroundColor: `${Colors.primary}25` }]} />
                </View>
                {shipment.shippingLine    && <InfoRow label="Shipping Line"     value={shipment.shippingLine} />}
                {shipment.vesselName      && <InfoRow label="Vessel Name"        value={shipment.vesselName} />}
                {shipment.voyageNumber    && <InfoRow label="Voyage Number"      value={shipment.voyageNumber} mono />}
                {shipment.bolNumber       && <InfoRow label="B/L Number"         value={shipment.bolNumber} mono />}
                {/* Multi-container or single container */}
                {shipment.containers && shipment.containers.length > 0 ? (
                  <View style={styles.containersList}>
                    <View style={styles.containersHeader}>
                      <MaterialIcons name="inventory-2" size={12} color="#38BDF8" />
                      <Text style={styles.containersTitle}>
                        {shipment.containers.length} CONTAINER{shipment.containers.length !== 1 ? 'S' : ''}
                      </Text>
                      <View style={{ flex: 1 }} />
                      <Pressable
                        style={({ pressed }) => [styles.editContainersBtn, pressed && { opacity: 0.75 }]}
                        onPress={openContainerEditor}
                      >
                        <MaterialIcons name="edit" size={11} color="#38BDF8" />
                        <Text style={styles.editContainersBtnText}>Edit</Text>
                      </Pressable>
                    </View>
                    {shipment.containers.map((c, idx) => (
                      <View key={idx} style={styles.containerRow}>
                        <View style={styles.containerIndexBadge}>
                          <Text style={styles.containerIndexText}>{idx + 1}</Text>
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={styles.containerNumber}>{c.container_number || '—'}</Text>
                          <View style={styles.containerMeta}>
                            {c.size ? <View style={styles.containerTag}><Text style={styles.containerTagText}>{c.size}</Text></View> : null}
                            {c.type ? <View style={styles.containerTag}><Text style={styles.containerTagText}>{c.type}</Text></View> : null}
                            {c.seal_number ? <Text style={styles.containerSeal}>Seal: {c.seal_number}</Text> : null}
                            {c.weight ? <Text style={styles.containerSeal}>{c.weight}</Text> : null}
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                ) : (
                  <View style={styles.containersHeader}>
                    <MaterialIcons name="inventory-2" size={12} color="#38BDF8" />
                    <Text style={styles.containersTitle}>NO CONTAINERS</Text>
                    <View style={{ flex: 1 }} />
                    <Pressable
                      style={({ pressed }) => [styles.editContainersBtn, pressed && { opacity: 0.75 }]}
                      onPress={openContainerEditor}
                    >
                      <MaterialIcons name="add" size={11} color="#38BDF8" />
                      <Text style={styles.editContainersBtnText}>Add</Text>
                    </Pressable>
                  </View>
                )}
                {shipment.containerNumber && !shipment.containers?.length ? (
                  <InfoRow label="Container Number" value={shipment.containerNumber} mono />
                ) : null}
                {shipment.portOfLoading   && <InfoRow label="Port of Loading"    value={shipment.portOfLoading} />}
                {shipment.portOfDischarge && <InfoRow label="Port of Discharge"  value={shipment.portOfDischarge} />}
              </>
            )}
            {/* Agreed price — admin view (read-only indicator) */}
            {shipment.agreedPrice ? (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Agreed Price</Text>
                <View style={styles.priceRow}>
                  <Text style={styles.priceValue}>{shipment.agreedPrice}</Text>
                  {localPriceAccepted ? (
                    <View style={styles.priceAcceptedBadge}>
                      <MaterialIcons name="check-circle" size={12} color={Colors.success} />
                      <Text style={styles.priceAcceptedText}>Accepted{localPriceAcceptedAt ? ` · ${localPriceAcceptedAt}` : ''}</Text>
                    </View>
                  ) : (
                    <View style={styles.pricePendingBadge}>
                      <MaterialIcons name="schedule" size={12} color={Colors.warning} />
                      <Text style={styles.pricePendingText}>Pending driver</Text>
                    </View>
                  )}
                </View>
              </View>
            ) : null}
          </View>
        </View>

        {/* ── Multi-Truck Fleet (Road) ── */}
        {shipment.shipmentType === 'Road' && shipment.additionalDrivers && shipment.additionalDrivers.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.fleetSectionLeft}>
                <View style={styles.fleetSectionIcon}>
                  <MaterialIcons name="local-shipping" size={11} color={Colors.primary} />
                </View>
                <Text style={styles.sectionTitle}>Fleet Assignment</Text>
                <View style={styles.fleetCountBadge}>
                  <Text style={styles.fleetCountText}>{(shipment.additionalDrivers.length + 1)} trucks</Text>
                </View>
              </View>
            </View>
            <View style={styles.fleetCard}>
              {/* Primary driver */}
              <View style={[styles.fleetRow, styles.fleetRowPrimary]}>
                <View style={styles.fleetAvatar}>
                  <Text style={styles.fleetAvatarText}>
                    {shipment.driverName.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.fleetNameRow}>
                    <View style={styles.fleetPrimaryBadge}><Text style={styles.fleetPrimaryBadgeText}>Lead</Text></View>
                    <Text style={styles.fleetName}>{shipment.driverName}</Text>
                  </View>
                  <Text style={styles.fleetMeta}>{shipment.plateNumber}</Text>
                </View>
              </View>
              {/* Additional drivers */}
              {shipment.additionalDrivers.map((d, idx) => (
                <View key={idx} style={[styles.fleetRow, idx < (shipment.additionalDrivers?.length ?? 0) - 1 && styles.fleetRowBorder]}>
                  <View style={[styles.fleetAvatar, styles.fleetAvatarAlt]}>
                    <Text style={styles.fleetAvatarTextAlt}>
                      {d.driver_name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.fleetNameRow}>
                      <View style={styles.fleetTruckBadge}><Text style={styles.fleetTruckBadgeText}>Truck {idx + 2}</Text></View>
                      <Text style={styles.fleetName}>{d.driver_name}</Text>
                    </View>
                    <Text style={styles.fleetMeta}>{d.plate_number}{d.truck_class ? ` · ${d.truck_class}` : ''}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Driver</Text>
            {onDriverAssign && (
              <Pressable
                style={({ pressed }) => [styles.assignBtn, pressed && { opacity: 0.75 }, updatingDriver && { opacity: 0.5 }]}
                onPress={() => setShowDriverPicker(true)}
                disabled={updatingDriver}
              >
                {updatingDriver ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : (
                  <>
                    <MaterialIcons name="swap-horiz" size={12} color={Colors.primary} />
                    <Text style={styles.assignBtnText}>Reassign</Text>
                  </>
                )}
              </Pressable>
            )}
          </View>
          <View style={styles.infoCard}>
            <InfoRow label="Name" value={localDriverName} />
            <InfoRow label="Plate Number" value={localPlate} mono />

            {/* ETA row — tappable if onETAChange is provided */}
            <View style={styles.infoRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1 }}>
                {shipment.shipmentType === 'Sea' && (
                  <MaterialIcons name="directions-boat" size={13} color={Colors.primary} />
                )}
                <Text style={[styles.infoLabel, { flex: 0 }]}>
                  {shipment.shipmentType === 'Sea' ? 'Port ETA' : 'Est. Arrival'}
                </Text>
              </View>
              {onETAChange ? (
                <Pressable
                  style={({ pressed }) => [styles.etaBtn, pressed && { opacity: 0.75 }, updatingETA && { opacity: 0.5 }]}
                  onPress={handleETAPress}
                  disabled={updatingETA}
                  accessibilityLabel="Edit estimated arrival date"
                >
                  {updatingETA ? (
                    <ActivityIndicator size="small" color={Colors.primary} />
                  ) : (
                    <>
                      <Text style={styles.etaBtnText}>{localETA || '—'}</Text>
                      <MaterialIcons name="edit-calendar" size={13} color={Colors.primary} />
                    </>
                  )}
                </Pressable>
              ) : (
                <Text style={styles.infoValue}>{localETA}</Text>
              )}
            </View>

            {/* Native date picker — renders inline below row on iOS/Android */}
            {showETAPicker && Platform.OS !== 'web' && DateTimePicker && (
              <DateTimePicker
                value={dateValue}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                minimumDate={new Date()}
                onChange={(_, date) => handleETAChange(date)}
                themeVariant="dark"
              />
            )}

            {/* Web inline date picker */}
            {showETAPicker && Platform.OS === 'web' && (
              <View style={styles.webDatePickerWrap}>
                {/* @ts-ignore - web-only input */}
                <input
                  type="date"
                  defaultValue={dateValue.toISOString().split('T')[0]}
                  style={{
                    backgroundColor: '#1c2433',
                    color: '#c9d1d9',
                    border: '1px solid #30363d',
                    borderRadius: 8,
                    padding: '10px 14px',
                    fontSize: 14,
                    width: '100%',
                    boxSizing: 'border-box',
                    cursor: 'pointer',
                    outline: 'none',
                    colorScheme: 'dark',
                  }}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const d = e.target.value ? new Date(e.target.value) : undefined;
                    handleETAChange(d);
                  }}
                />
              </View>
            )}

            <InfoRow label="Last Update" value={shipment.updatedAt} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Checkpoints</Text>
          <View style={styles.infoCard}>
            <CheckpointProgress checkpoints={shipment.checkpoints} />
          </View>
        </View>

        {/* ── Route History Section ─────────────────────────────────── */}
        <View style={styles.section}>
          <Pressable
            style={({ pressed }) => [styles.sectionHeaderRow, pressed && { opacity: 0.8 }]}
            onPress={() => setHistoryExpanded(v => !v)}
          >
            <View style={styles.routeHistoryLeft}>
              <View style={styles.routeHistoryIcon}>
                <MaterialIcons name="route" size={11} color={Colors.success} />
              </View>
              <Text style={[styles.sectionTitle, { color: Colors.success }]}>Route History</Text>
              {routeHistory.length > 0 && (
                <View style={styles.historyCountBadge}>
                  <Text style={styles.historyCountText}>{routeHistory.length} pts</Text>
                </View>
              )}
              {historyLoading && (
                <ActivityIndicator size="small" color={Colors.success} style={{ marginLeft: 4 }} />
              )}
            </View>
            <View style={styles.routeHistoryRight}>
              {routeHistory.length > 0 && (
                <Pressable
                  style={({ pressed }) => [styles.historyMapToggle, showHistoryMap && styles.historyMapToggleActive, pressed && { opacity: 0.8 }]}
                  onPress={(e) => { e.stopPropagation?.(); setShowHistoryMap(v => !v); setHistoryExpanded(true); }}
                >
                  <MaterialIcons name="map" size={12} color={showHistoryMap ? Colors.success : Colors.textMuted} />
                  <Text style={[styles.historyMapToggleText, showHistoryMap && { color: Colors.success }]}>Map</Text>
                </Pressable>
              )}
              <MaterialIcons
                name={historyExpanded ? 'expand-less' : 'expand-more'}
                size={18}
                color={Colors.textMuted}
              />
            </View>
          </Pressable>

          {historyExpanded && (
            <>
              {/* Map view of the actual route */}
              {showHistoryMap && routeHistory.length > 0 && (
                <View style={styles.historyMapWrap}>
                  {LiveMapComponent ? (
                    <LiveMapComponent
                      shipments={[shipment]}
                      focusShipment={shipment}
                      height={200}
                      showAllShipments={false}
                      routeHistory={routeHistory}
                    />
                  ) : (
                    <View style={[styles.historyEmptyBox, { height: 200 }]}>
                      <MaterialIcons name="map" size={28} color={Colors.border} />
                      <Text style={styles.historyEmptyTitle}>Map requires native build</Text>
                      <Text style={styles.historyEmptySub}>Download the APK/IPA to view the route map.</Text>
                    </View>
                  )}
                  <View style={styles.historyMapLegend}>
                    <View style={styles.historyLegendItem}>
                      <View style={[styles.historyLegendLine, { backgroundColor: Colors.success }]} />
                      <Text style={styles.historyLegendText}>Actual path ({routeHistory.length} fixes)</Text>
                    </View>
                    <View style={styles.historyLegendItem}>
                      <View style={[styles.historyLegendLine, { backgroundColor: Colors.primary, opacity: 0.5 }]} />
                      <Text style={styles.historyLegendText}>Planned route</Text>
                    </View>
                  </View>
                </View>
              )}

              {/* Breadcrumb timeline list */}
              {historyLoading ? (
                <View style={styles.historyLoadingBox}>
                  <ActivityIndicator size="small" color={Colors.success} />
                  <Text style={styles.historyLoadingText}>Loading GPS trail...</Text>
                </View>
              ) : routeHistory.length === 0 ? (
                <View style={styles.historyEmptyBox}>
                  <MaterialIcons name="gps-off" size={24} color={Colors.border} />
                  <Text style={styles.historyEmptyTitle}>No GPS history yet</Text>
                  <Text style={styles.historyEmptySub}>GPS breadcrumbs are logged every 15 seconds while the driver is tracking.</Text>
                </View>
              ) : (
                <View style={styles.historyTimelineWrap}>
                  {/* Summary row */}
                  <View style={styles.historyStatsRow}>
                    {[
                      {
                        icon: 'place' as const,
                        label: 'First Fix',
                        value: new Date(routeHistory[0].recordedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
                        color: Colors.success,
                      },
                      {
                        icon: 'schedule' as const,
                        label: 'Duration',
                        value: (() => {
                          const ms = new Date(routeHistory[routeHistory.length - 1].recordedAt).getTime() - new Date(routeHistory[0].recordedAt).getTime();
                          const h = Math.floor(ms / 3600000);
                          const m = Math.floor((ms % 3600000) / 60000);
                          return h > 0 ? `${h}h ${m}m` : `${m}m`;
                        })(),
                        color: Colors.primary,
                      },
                      {
                        icon: 'gps-fixed' as const,
                        label: 'Updates',
                        value: String(routeHistory.length),
                        color: Colors.info,
                      },
                    ].map((item, i, arr) => (
                      <React.Fragment key={item.label}>
                        {i > 0 && <View style={styles.historyStatDivider} />}
                        <View style={styles.historyStat}>
                          <MaterialIcons name={item.icon} size={13} color={item.color} />
                          <Text style={[styles.historyStatValue, { color: item.color }]}>{item.value}</Text>
                          <Text style={styles.historyStatLabel}>{item.label}</Text>
                        </View>
                      </React.Fragment>
                    ))}
                  </View>

                  {/* Scrollable breadcrumb list — show last 20 points */}
                  <ScrollView
                    style={styles.historyList}
                    showsVerticalScrollIndicator={false}
                    nestedScrollEnabled
                  >
                    {[...routeHistory].reverse().slice(0, 20).map((pt, i, arr) => {
                      const isLatest = i === 0;
                      const time = new Date(pt.recordedAt);
                      return (
                        <View key={pt.id} style={styles.historyRow}>
                          {/* Timeline connector */}
                          <View style={styles.historyTimeline}>
                            <View style={[
                              styles.historyTimelineDot,
                              isLatest && styles.historyTimelineDotActive,
                            ]} />
                            {i < arr.length - 1 && <View style={styles.historyTimelineLine} />}
                          </View>

                          <View style={styles.historyRowContent}>
                            <View style={styles.historyRowHeader}>
                              <Text style={[styles.historyTime, isLatest && { color: Colors.success }]}>
                                {time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </Text>
                              <Text style={styles.historyDate}>
                                {time.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                              </Text>
                              {isLatest && (
                                <View style={styles.latestBadge}>
                                  <Text style={styles.latestBadgeText}>LATEST</Text>
                                </View>
                              )}
                            </View>
                            <View style={styles.historyMeta}>
                              <View style={styles.historyMetaItem}>
                                <MaterialIcons name="my-location" size={10} color={Colors.textMuted} />
                                <Text style={styles.historyMetaText}>
                                  {pt.lat.toFixed(5)}, {pt.lng.toFixed(5)}
                                </Text>
                              </View>
                              {pt.speed != null && pt.speed >= 0 && (
                                <View style={styles.historyMetaItem}>
                                  <MaterialIcons name="speed" size={10} color={Colors.textMuted} />
                                  <Text style={styles.historyMetaText}>
                                    {Math.round(pt.speed * 3.6)} km/h
                                  </Text>
                                </View>
                              )}
                              {pt.accuracy != null && (
                                <View style={styles.historyMetaItem}>
                                  <MaterialIcons name="gps-fixed" size={10} color={Colors.textMuted} />
                                  <Text style={styles.historyMetaText}>
                                    ±{Math.round(pt.accuracy)}m
                                  </Text>
                                </View>
                              )}
                            </View>
                          </View>
                        </View>
                      );
                    })}
                    {routeHistory.length > 20 && (
                      <View style={styles.historyMoreNote}>
                        <MaterialIcons name="info-outline" size={12} color={Colors.textMuted} />
                        <Text style={styles.historyMoreText}>Showing latest 20 of {routeHistory.length} fixes</Text>
                      </View>
                    )}
                  </ScrollView>
                </View>
              )}
            </>
          )}
        </View>

        {/* ── Sea Tracking Map ──────────────────────────────────── */}
        {shipment.shipmentType === 'Sea' && (() => {
          const SeaMap = getLazySeaTrackingMap();
          if (!SeaMap) return null;
          return (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.seaMapSectionLeft}>
                  <View style={styles.seaMapSectionIcon}>
                    <MaterialIcons name="directions-boat" size={11} color={'#58C4DC'} />
                  </View>
                  <Text style={[styles.sectionTitle, { color: '#58C4DC' }]}>Sea Route Tracker</Text>
                  {shipment.lat && shipment.lng && (
                    <View style={styles.vesselLiveBadge}>
                      <View style={styles.vesselLiveDot} />
                      <Text style={styles.vesselLiveText}>LIVE</Text>
                    </View>
                  )}
                </View>
                {shipment.incoterms && (
                  <View style={styles.incotermsBadge}>
                    <Text style={styles.incotermsText}>{shipment.incoterms}</Text>
                  </View>
                )}
              </View>
              <SeaMap shipment={shipment} />
            </View>
          );
        })()}

        {/* ── Shipment Chat Section ───────────────────────────────── */}
        <View style={[styles.section, { minHeight: 300 }]}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.chatSectionLeft}>
              <View style={styles.chatSectionIcon}>
                <MaterialIcons name="chat" size={11} color={Colors.primary} />
              </View>
              <Text style={styles.sectionTitle}>Order Chat</Text>
            </View>
            <View style={styles.chatSectionRight}>
              <MaterialIcons name="verified-user" size={12} color={Colors.success} />
              <Text style={styles.chatSectionPrivate}>Private · this order only</Text>
            </View>
          </View>
          <ShipmentChat shipment={shipment} role="admin" compact />
        </View>

        {/* ── Documents Section ──────────────────────────────────────── */}
        <View style={[styles.section, { paddingBottom: 80 }]}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.docsSectionLeft}>
              <View style={styles.docsSectionIcon}>
                <MaterialIcons name="folder" size={11} color={Colors.primary} />
              </View>
              <Text style={styles.sectionTitle}>Cargo Documents</Text>
              {documents.length > 0 && (
                <View style={styles.docsCountBadge}>
                  <Text style={styles.docsCountText}>{documents.length}</Text>
                </View>
              )}
            </View>
            <Pressable
              style={({ pressed }) => [styles.docsOpenBtn, pressed && { opacity: 0.8 }]}
              onPress={() => Linking.openURL(`/tracking?number=${encodeURIComponent(shipment.tirNumber)}`)}
            >
              <MaterialIcons name="open-in-new" size={11} color={Colors.textMuted} />
              <Text style={styles.docsOpenBtnText}>Tracking</Text>
            </Pressable>
          </View>

          {docsLoading ? (
            <View style={styles.docsLoadingBox}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={styles.docsLoadingText}>Loading documents...</Text>
            </View>
          ) : documents.length === 0 ? (
            <View style={styles.docsEmptyBox}>
              <MaterialIcons name="photo-camera" size={28} color={Colors.border} />
              <Text style={styles.docsEmptyTitle}>No documents uploaded</Text>
              <Text style={styles.docsEmptySub}>Driver can upload cargo photos from the Job tab.</Text>
            </View>
          ) : (
            <View style={styles.docsGrid}>
              {documents.map((doc, index) => (
                <Pressable
                  key={doc.id}
                  style={({ pressed }) => [styles.docThumb, pressed && { opacity: 0.85 }]}
                  onPress={() => openLightbox(doc, index)}
                >
                  <Image
                    source={{ uri: doc.fileUrl }}
                    style={styles.docThumbImg}
                    contentFit="cover"
                    transition={200}
                  />
                  <View style={styles.docThumbOverlay}>
                    <View style={styles.docThumbFooter}>
                      <Text style={styles.docThumbDate}>
                        {new Date(doc.uploadedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                      </Text>
                      <MaterialIcons name="zoom-in" size={12} color="rgba(255,255,255,0.8)" />
                    </View>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* ── Lightbox Modal ─────────────────────────────────────────────── */}
      <Modal
        visible={lightboxDoc !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxDoc(null)}
        statusBarTranslucent
      >
        <View style={styles.lightboxOverlay}>
          {/* Header */}
          <View style={styles.lightboxHeader}>
            <View style={styles.lightboxHeaderLeft}>
              <MaterialIcons name="folder" size={14} color={Colors.primary} />
              <Text style={styles.lightboxTitle} numberOfLines={1}>
                {lightboxDoc?.fileName ?? ''}
              </Text>
            </View>
            <View style={styles.lightboxHeaderRight}>
              <Pressable
                style={({ pressed }) => [styles.lightboxIconBtn, pressed && { opacity: 0.7 }]}
                onPress={() => lightboxDoc && Linking.openURL(lightboxDoc.fileUrl)}
                hitSlop={8}
              >
                <MaterialIcons name="open-in-new" size={18} color={Colors.textSecondary} />
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.lightboxIconBtn, styles.lightboxDeleteBtn, pressed && { opacity: 0.7 }]}
                onPress={() => lightboxDoc && handleDeleteDoc(lightboxDoc.id)}
                hitSlop={8}
              >
                <MaterialIcons name="delete-outline" size={18} color={Colors.danger} />
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.lightboxIconBtn, pressed && { opacity: 0.7 }]}
                onPress={() => setLightboxDoc(null)}
                hitSlop={8}
              >
                <MaterialIcons name="close" size={20} color={Colors.textPrimary} />
              </Pressable>
            </View>
          </View>

          {/* Image */}
          <View style={styles.lightboxImageWrap}>
            {lightboxDoc && (
              <Image
                source={{ uri: lightboxDoc.fileUrl }}
                style={styles.lightboxImage}
                contentFit="contain"
                transition={200}
              />
            )}
          </View>

          {/* Navigation & Meta */}
          <View style={styles.lightboxFooter}>
            <Pressable
              style={({ pressed }) => [styles.lightboxNavBtn, pressed && { opacity: 0.7 }, lightboxIndex === 0 && { opacity: 0.3 }]}
              onPress={() => navigateLightbox(-1)}
              disabled={lightboxIndex === 0}
            >
              <MaterialIcons name="chevron-left" size={22} color={Colors.textPrimary} />
            </Pressable>

            <View style={styles.lightboxMeta}>
              <Text style={styles.lightboxCounter}>{lightboxIndex + 1} / {documents.length}</Text>
              {lightboxDoc && (
                <Text style={styles.lightboxDate}>
                  {new Date(lightboxDoc.uploadedAt).toLocaleDateString('en-GB', {
                    day: 'numeric', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </Text>
              )}
            </View>

            <Pressable
              style={({ pressed }) => [styles.lightboxNavBtn, pressed && { opacity: 0.7 }, lightboxIndex >= documents.length - 1 && { opacity: 0.3 }]}
              onPress={() => navigateLightbox(1)}
              disabled={lightboxIndex >= documents.length - 1}
            >
              <MaterialIcons name="chevron-right" size={22} color={Colors.textPrimary} />
            </Pressable>
          </View>

          {/* Thumbnail strip */}
          {documents.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.lightboxStrip}
              contentContainerStyle={styles.lightboxStripContent}
            >
              {documents.map((doc, i) => (
                <Pressable
                  key={doc.id}
                  style={({ pressed }) => [styles.lightboxStripThumb, i === lightboxIndex && styles.lightboxStripThumbActive, pressed && { opacity: 0.8 }]}
                  onPress={() => { setLightboxDoc(doc); setLightboxIndex(i); }}
                >
                  <Image
                    source={{ uri: doc.fileUrl }}
                    style={styles.lightboxStripImg}
                    contentFit="cover"
                    transition={150}
                  />
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* ── Container Editor Modal ──────────────────────────────────────────── */}
      <Modal
        visible={showContainerEditor}
        transparent
        animationType="slide"
        onRequestClose={() => setShowContainerEditor(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => !savingContainers && setShowContainerEditor(false)}>
          <Pressable style={[styles.pickerSheet, { maxHeight: '90%' }]} onPress={e => e.stopPropagation()}>
            {/* Header */}
            <View style={styles.ceHeader}>
              <View style={styles.ceHeaderLeft}>
                <View style={styles.ceHeaderIcon}>
                  <MaterialIcons name="inventory-2" size={14} color="#38BDF8" />
                </View>
                <View>
                  <Text style={styles.ceHeaderTitle}>Edit Containers</Text>
                  <Text style={styles.ceHeaderSub}>{shipment.tirNumber} · {shipment.bolNumber ?? 'No B/L'}</Text>
                </View>
              </View>
              <Pressable style={styles.closeBtn} onPress={() => setShowContainerEditor(false)} disabled={savingContainers}>
                <MaterialIcons name="close" size={18} color={Colors.textSecondary} />
              </Pressable>
            </View>

            {/* Container count banner */}
            <View style={styles.ceBanner}>
              <View style={styles.ceBannerLeft}>
                <MaterialIcons name="inventory-2" size={13} color="#38BDF8" />
                <Text style={styles.ceBannerCount}>{editContainers.length}</Text>
                <Text style={styles.ceBannerLabel}>container{editContainers.length !== 1 ? 's' : ''} under this B/L</Text>
              </View>
              <Pressable
                style={({ pressed }) => [styles.ceAddBtn, pressed && { opacity: 0.8 }]}
                onPress={addEditContainer}
              >
                <MaterialIcons name="add" size={14} color={Colors.primary} />
                <Text style={styles.ceAddBtnText}>Add Container</Text>
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {editContainers.length === 0 ? (
                <Pressable style={styles.ceEmpty} onPress={addEditContainer}>
                  <MaterialIcons name="inventory-2" size={26} color={Colors.border} />
                  <Text style={styles.ceEmptyText}>No containers yet</Text>
                  <Text style={styles.ceEmptySub}>Tap to add the first container</Text>
                </Pressable>
              ) : (
                <View style={styles.ceList}>
                  {editContainers.map((c, idx) => (
                    <View key={c._key} style={styles.ceCard}>
                      {/* Card header */}
                      <View style={styles.ceCardHeader}>
                        <View style={styles.ceCardIndexBadge}>
                          <Text style={styles.ceCardIndexText}>{idx + 1}</Text>
                        </View>
                        <Text style={styles.ceCardTitle}>Container #{idx + 1}</Text>
                        <Pressable onPress={() => removeEditContainer(c._key)} hitSlop={8}>
                          <MaterialIcons name="delete-outline" size={16} color={Colors.danger} />
                        </Pressable>
                      </View>

                      {/* Container number */}
                      <View style={styles.ceFieldRow}>
                        <MaterialIcons name="inventory-2" size={13} color={Colors.textMuted} />
                        <TextInput
                          style={styles.ceInput}
                          value={c.container_number}
                          onChangeText={v => updateEditContainer(c._key, 'container_number', v)}
                          placeholder="Container No. (e.g. MSCU1234567)"
                          placeholderTextColor={Colors.textMuted}
                          autoCapitalize="characters"
                        />
                      </View>

                      {/* Seal + Weight */}
                      <View style={styles.ceTwoCol}>
                        <View style={[styles.ceFieldRow, { flex: 1 }]}>
                          <MaterialIcons name="lock" size={13} color={Colors.textMuted} />
                          <TextInput
                            style={styles.ceInput}
                            value={c.seal_number ?? ''}
                            onChangeText={v => updateEditContainer(c._key, 'seal_number', v)}
                            placeholder="Seal No."
                            placeholderTextColor={Colors.textMuted}
                            autoCapitalize="characters"
                          />
                        </View>
                        <View style={[styles.ceFieldRow, { flex: 1 }]}>
                          <MaterialIcons name="straighten" size={13} color={Colors.textMuted} />
                          <TextInput
                            style={styles.ceInput}
                            value={c.weight ?? ''}
                            onChangeText={v => updateEditContainer(c._key, 'weight', v)}
                            placeholder="Weight"
                            placeholderTextColor={Colors.textMuted}
                          />
                        </View>
                      </View>

                      {/* Size chips */}
                      <View style={styles.ceChipsSection}>
                        <Text style={styles.ceChipLabel}>SIZE</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ceChipsRow}>
                          {(['20ft', '40ft', '40ft HC', '45ft', '20ft OT', '40ft OT'] as const).map(s => (
                            <Pressable
                              key={s}
                              style={[styles.ceChip, c.size === s && styles.ceChipActive]}
                              onPress={() => updateEditContainer(c._key, 'size', s)}
                            >
                              <Text style={[styles.ceChipText, c.size === s && styles.ceChipTextActive]}>{s}</Text>
                            </Pressable>
                          ))}
                        </ScrollView>
                      </View>

                      {/* Type chips */}
                      <View style={styles.ceChipsSection}>
                        <Text style={styles.ceChipLabel}>TYPE</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ceChipsRow}>
                          {(['Dry', 'Reefer', 'Open Top', 'Flat Rack', 'Tank', 'Bulk'] as const).map(t => (
                            <Pressable
                              key={t}
                              style={[styles.ceChip, c.type === t && styles.ceChipActive]}
                              onPress={() => updateEditContainer(c._key, 'type', t)}
                            >
                              <Text style={[styles.ceChipText, c.type === t && styles.ceChipTextActive]}>{t}</Text>
                            </Pressable>
                          ))}
                        </ScrollView>
                      </View>
                    </View>
                  ))}
                </View>
              )}
              <View style={{ height: 16 }} />
            </ScrollView>

            {/* Error */}
            {containerSaveError ? (
              <View style={styles.ceErrorBox}>
                <MaterialIcons name="error-outline" size={14} color={Colors.danger} />
                <Text style={styles.ceErrorText} numberOfLines={2}>{containerSaveError}</Text>
              </View>
            ) : null}

            {/* Footer actions */}
            <View style={styles.ceFooter}>
              <Pressable
                style={({ pressed }) => [styles.ceCancelBtn, pressed && { opacity: 0.75 }]}
                onPress={() => setShowContainerEditor(false)}
                disabled={savingContainers}
              >
                <Text style={styles.ceCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.ceSaveBtn, pressed && { opacity: 0.85 }, savingContainers && { opacity: 0.6 }]}
                onPress={saveContainers}
                disabled={savingContainers}
              >
                {savingContainers
                  ? <ActivityIndicator size="small" color="#fff" />
                  : (<><MaterialIcons name="save" size={15} color="#fff" /><Text style={styles.ceSaveBtnText}>Save Containers</Text></>)
                }
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Driver Picker Modal */}
      <Modal
        visible={showDriverPicker}
        transparent
        animationType="slide"
        onRequestClose={() => { setShowDriverPicker(false); setDriverSearch(''); }}
      >
        <Pressable style={styles.modalOverlay} onPress={() => { setShowDriverPicker(false); setDriverSearch(''); }}>
          <Pressable style={[styles.pickerSheet, { maxHeight: '80%' }]} onPress={e => e.stopPropagation()}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Assign Driver</Text>
              <Text style={styles.pickerSubtitle}>{shipment.tirNumber}</Text>
            </View>

            <View style={styles.driverSearchWrap}>
              <MaterialIcons name="search" size={16} color={Colors.textMuted} />
              <TextInput
                style={styles.driverSearchInput}
                value={driverSearch}
                onChangeText={setDriverSearch}
                placeholder="Search name or plate..."
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
              />
              {driverSearch ? (
                <Pressable onPress={() => setDriverSearch('')}>
                  <MaterialIcons name="close" size={14} color={Colors.textMuted} />
                </Pressable>
              ) : null}
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Pressable
                style={({ pressed }) => [styles.driverPickerItem, pressed && { opacity: 0.75 }]}
                onPress={() => handleDriverAssign(null)}
              >
                <View style={[styles.driverPickerAvatar, { backgroundColor: Colors.surface, borderColor: Colors.border }]}>
                  <MaterialIcons name="person-off" size={18} color={Colors.textMuted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.driverPickerName}>Unassigned</Text>
                  <Text style={styles.driverPickerSub}>Remove driver from shipment</Text>
                </View>
              </Pressable>

              {filteredDrivers.length === 0 && driverSearch ? (
                <View style={styles.driverPickerEmpty}>
                  <Text style={styles.driverPickerEmptyText}>No drivers match</Text>
                </View>
              ) : (
                filteredDrivers.map(driver => (
                  <Pressable
                    key={driver.id}
                    style={({ pressed }) => [
                      styles.driverPickerItem,
                      (localDriverName === driver.fullName) && styles.driverPickerItemActive,
                      pressed && { opacity: 0.75 },
                    ]}
                    onPress={() => handleDriverAssign(driver)}
                  >
                    <View style={styles.driverPickerAvatar}>
                      <Text style={styles.driverPickerAvatarText}>{driver.avatarInitials}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.driverPickerName}>{driver.fullName}</Text>
                      <Text style={styles.driverPickerSub}>{driver.plateNumber} · {driver.truckClass}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <View style={[styles.driverStatusDot, {
                        backgroundColor: driver.status === 'Active' ? Colors.success : driver.status === 'Idle' ? Colors.warning : Colors.textMuted,
                      }]} />
                      <Text style={styles.driverStatusText}>{driver.status}</Text>
                    </View>
                    {localDriverName === driver.fullName && (
                      <MaterialIcons name="check-circle" size={18} color={Colors.primary} />
                    )}
                  </Pressable>
                ))
              )}
            </ScrollView>

            <Pressable style={styles.pickerCancel} onPress={() => { setShowDriverPicker(false); setDriverSearch(''); }}>
              <Text style={styles.pickerCancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Status Picker Modal */}
      <Modal
        visible={showStatusPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowStatusPicker(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowStatusPicker(false)}>
          <Pressable style={styles.pickerSheet} onPress={e => e.stopPropagation()}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Update Shipment Status</Text>
              <Text style={styles.pickerSubtitle}>{shipment.tirNumber}</Text>
            </View>
            {STATUS_OPTIONS.map((opt, i) => (
              <Pressable
                key={opt.value}
                style={({ pressed }) => [
                  styles.pickerOption,
                  i < STATUS_OPTIONS.length - 1 && styles.pickerOptionBorder,
                  localStatus === opt.value && styles.pickerOptionActive,
                  pressed && { backgroundColor: `${opt.color}12` },
                ]}
                onPress={() => handleStatusChange(opt.value)}
              >
                <View style={[styles.pickerOptionIcon, { backgroundColor: `${opt.color}18`, borderColor: `${opt.color}40` }]}>
                  <MaterialIcons name={opt.icon} size={16} color={opt.color} />
                </View>
                <Text style={[styles.pickerOptionText, { color: localStatus === opt.value ? opt.color : Colors.textPrimary }]}>
                  {opt.label}
                </Text>
                {localStatus === opt.value && (
                  <MaterialIcons name="check" size={16} color={opt.color} />
                )}
              </Pressable>
            ))}
            <Pressable style={styles.pickerCancel} onPress={() => setShowStatusPicker(false)}>
              <Text style={styles.pickerCancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: Spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  modalSubtitle: { fontSize: FontSize.xs, color: Colors.textMuted, fontFamily: 'monospace', marginTop: 2 },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  scroll: { flex: 1 },
  section: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl, gap: Spacing.md },
  sectionHeaderRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  sectionTitle: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary, letterSpacing: 0.8, textTransform: 'uppercase' },
  assignBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.full,
    paddingHorizontal: 9, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    minWidth: 80, justifyContent: 'center',
  },
  assignBtnText: {
    fontSize: 11, fontWeight: '600', color: Colors.primary,
  },
  // Driver picker
  driverSearchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.xl, marginBottom: 4,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md,
  },
  driverSearchInput: {
    flex: 1, paddingVertical: 10, fontSize: FontSize.base, color: Colors.textPrimary,
  },
  driverPickerItem: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  driverPickerItemActive: {
    backgroundColor: Colors.card,
  },
  driverPickerAvatar: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  driverPickerAvatarText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  driverPickerName: { fontSize: FontSize.base, fontWeight: '600', color: Colors.textPrimary },
  driverPickerSub: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  driverPickerEmpty: { alignItems: 'center', padding: 32 },
  driverPickerEmptyText: { color: Colors.textMuted, fontSize: FontSize.base },
  driverStatusDot: { width: 8, height: 8, borderRadius: 4 },
  driverStatusText: { fontSize: 10, color: Colors.textMuted },
  infoCard: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
    gap: Spacing.sm,
  },
  infoLabel: { fontSize: FontSize.sm, color: Colors.textSecondary, flex: 1 },
  infoValue: { fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: '500', flex: 2, textAlign: 'right' },
  mono: { fontFamily: 'monospace', color: Colors.primary },
  routeCard: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: 0,
  },
  routeItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  routeCircle: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, alignItems: 'center', justifyContent: 'center',
  },
  routeInner: { width: 8, height: 8, borderRadius: 4 },
  routeConnector: {
    marginLeft: 9,
    height: 20,
    borderLeftWidth: 1.5,
    borderStyle: 'dashed',
    marginVertical: 4,
  },
  routeLabel: { fontSize: FontSize.xs, color: Colors.textMuted },
  routeValue: { fontSize: FontSize.base, fontWeight: '600', color: Colors.textPrimary },
  statusShareRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  statusLeft: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  statusChangeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.full,
    paddingHorizontal: 9, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    minWidth: 72, justifyContent: 'center',
  },
  statusChangeBtnText: {
    fontSize: 11, fontWeight: '600', color: Colors.primary,
  },
  etaBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.md,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
    minHeight: 32, justifyContent: 'center' as const,
    minWidth: 140,
  },
  etaBtnText: {
    fontSize: FontSize.sm, fontWeight: '500' as const, color: Colors.primaryLight,
  },
  webDatePickerWrap: {
    marginHorizontal: Spacing.lg,
    marginTop: 4,
    marginBottom: Spacing.sm,
  },
  transportModeRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5,
  },
  // Documents section
  docsSectionLeft: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
  },
  docsSectionIcon: {
    width: 20, height: 20, borderRadius: 6, backgroundColor: Colors.primaryGlow,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  docsCountBadge: {
    backgroundColor: Colors.primaryGlow, borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
  },
  docsCountText: { fontSize: 10, fontWeight: '700' as const, color: Colors.primary },
  docsOpenBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 3,
    paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.full,
    borderWidth: 1, borderColor: Colors.border,
  },
  docsOpenBtnText: { fontSize: 10, color: Colors.textMuted, fontWeight: '500' as const },
  docsLoadingBox: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: Spacing.sm,
    justifyContent: 'center' as const, paddingVertical: Spacing.xl,
  },
  docsLoadingText: { fontSize: FontSize.sm, color: Colors.textMuted },
  docsEmptyBox: {
    alignItems: 'center' as const, gap: 6, paddingVertical: Spacing.xl,
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed' as const,
  },
  docsEmptyTitle: { fontSize: FontSize.sm, fontWeight: '600' as const, color: Colors.textMuted },
  docsEmptySub: { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center' as const, paddingHorizontal: Spacing.lg },
  docsGrid: {
    flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8,
  },
  docThumb: {
    width: DOC_THUMB_W,
    height: DOC_THUMB_W,
    borderRadius: BorderRadius.md,
    overflow: 'hidden' as const,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: Colors.border,
    ...Shadow.card,
  },
  docThumbImg: { width: DOC_THUMB_W, height: DOC_THUMB_W },
  docThumbOverlay: {
    position: 'absolute' as const, bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 6, paddingVertical: 4,
  },
  docThumbFooter: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const,
  },
  docThumbDate: { fontSize: 9, color: 'rgba(255,255,255,0.9)', fontWeight: '600' as const },

  // Lightbox
  lightboxOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.96)',
    flexDirection: 'column' as const,
  },
  lightboxHeader: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const,
    paddingHorizontal: Spacing.xl, paddingTop: 52, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  lightboxHeaderLeft: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, flex: 1 },
  lightboxHeaderRight: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  lightboxTitle: { fontSize: FontSize.sm, color: Colors.textSecondary, flex: 1 },
  lightboxIconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  lightboxDeleteBtn: { backgroundColor: 'rgba(248,81,73,0.12)' },
  lightboxImageWrap: {
    flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const,
    paddingHorizontal: Spacing.lg,
  },
  lightboxImage: { width: '100%', height: '100%' },
  lightboxFooter: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)',
  },
  lightboxNavBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  lightboxMeta: { alignItems: 'center' as const, gap: 3 },
  lightboxCounter: { fontSize: FontSize.sm, fontWeight: '700' as const, color: Colors.textPrimary },
  lightboxDate: { fontSize: FontSize.xs, color: Colors.textMuted },
  lightboxStrip: {
    maxHeight: 72, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)',
  },
  lightboxStripContent: {
    paddingHorizontal: Spacing.lg, paddingVertical: 8, gap: 6, flexDirection: 'row' as const,
  },
  lightboxStripThumb: {
    width: 56, height: 56, borderRadius: BorderRadius.sm,
    overflow: 'hidden' as const,
    borderWidth: 1.5, borderColor: 'transparent',
    opacity: 0.55,
  },
  lightboxStripThumbActive: {
    borderColor: Colors.primary, opacity: 1,
  },
  lightboxStripImg: { width: 56, height: 56 },

  // Type-specific detail divider
  typeDetailDivider: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: 4,
    backgroundColor: Colors.bg,
  },
  typeDetailLabel: {
    fontSize: 10, fontWeight: '700' as const, letterSpacing: 0.8,
  },
  typeDetailLine: { flex: 1, height: 1 },

  priceRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
  },
  priceValue: {
    fontSize: FontSize.sm, fontWeight: '700' as const, color: Colors.success,
  },
  priceAcceptedBadge: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 3,
    backgroundColor: Colors.successBg, borderRadius: BorderRadius.full,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  priceAcceptedText: {
    fontSize: 10, color: Colors.success, fontWeight: '600' as const,
  },
  pricePendingBadge: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 3,
    backgroundColor: Colors.warningBg, borderRadius: BorderRadius.full,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  pricePendingText: {
    fontSize: 10, color: Colors.warning, fontWeight: '600' as const,
  },
  // Edit containers button
  editContainersBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(56,189,248,0.1)', borderRadius: BorderRadius.full,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(56,189,248,0.3)',
  },
  editContainersBtnText: { fontSize: 10, fontWeight: '700', color: '#38BDF8' },

  // Container editor modal styles
  ceHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: Spacing.xl, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  ceHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  ceHeaderIcon: {
    width: 36, height: 36, borderRadius: BorderRadius.md,
    backgroundColor: 'rgba(56,189,248,0.12)', borderWidth: 1, borderColor: 'rgba(56,189,248,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  ceHeaderTitle: { fontSize: FontSize.base, fontWeight: '700', color: Colors.textPrimary },
  ceHeaderSub: { fontSize: FontSize.xs, color: Colors.textMuted, fontFamily: 'monospace', marginTop: 2 },
  ceBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingVertical: 10,
    backgroundColor: 'rgba(56,189,248,0.06)', borderBottomWidth: 1, borderBottomColor: 'rgba(56,189,248,0.15)',
  },
  ceBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ceBannerCount: { fontSize: FontSize.lg, fontWeight: '800', color: '#38BDF8' },
  ceBannerLabel: { fontSize: FontSize.xs, color: Colors.textSecondary },
  ceAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.full,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
  },
  ceAddBtnText: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.primary },
  ceEmpty: {
    alignItems: 'center', gap: 6, margin: Spacing.xl,
    paddingVertical: Spacing.xxxl,
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed',
  },
  ceEmptyText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textMuted },
  ceEmptySub: { fontSize: FontSize.xs, color: Colors.textMuted },
  ceList: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md, gap: Spacing.md },
  ceCard: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: 'rgba(56,189,248,0.2)', overflow: 'hidden',
  },
  ceCardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: 'rgba(56,189,248,0.06)',
    paddingHorizontal: Spacing.md, paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: 'rgba(56,189,248,0.15)',
  },
  ceCardIndexBadge: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(56,189,248,0.2)', borderWidth: 1, borderColor: 'rgba(56,189,248,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  ceCardIndexText: { fontSize: 10, fontWeight: '800', color: '#38BDF8' },
  ceCardTitle: { flex: 1, fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  ceFieldRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  ceTwoCol: { flexDirection: 'row' },
  ceInput: { flex: 1, fontSize: FontSize.sm, color: Colors.textPrimary, paddingVertical: 2 },
  ceChipsSection: { paddingHorizontal: Spacing.md, paddingVertical: 8, gap: 4 },
  ceChipLabel: { fontSize: 9, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.8 },
  ceChipsRow: { flexDirection: 'row', gap: 6 },
  ceChip: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.full,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.border,
  },
  ceChipActive: { backgroundColor: 'rgba(56,189,248,0.15)', borderColor: 'rgba(56,189,248,0.4)' },
  ceChipText: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '500' },
  ceChipTextActive: { color: '#38BDF8', fontWeight: '700' },
  ceErrorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6, margin: Spacing.xl, marginBottom: 0,
    backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: `${Colors.danger}30`,
  },
  ceErrorText: { flex: 1, fontSize: FontSize.xs, color: Colors.danger },
  ceFooter: {
    flexDirection: 'row', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  ceCancelBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    paddingVertical: 13, borderWidth: 1, borderColor: Colors.border,
  },
  ceCancelText: { fontSize: FontSize.base, fontWeight: '600', color: Colors.textSecondary },
  ceSaveBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.md, paddingVertical: 13,
  },
  ceSaveBtnText: { fontSize: FontSize.base, fontWeight: '700', color: '#fff' },

  // Containers list
  containersList: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: 'rgba(56,189,248,0.25)', overflow: 'hidden',
  },
  containersHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(56,189,248,0.08)',
    paddingHorizontal: Spacing.lg, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: 'rgba(56,189,248,0.15)',
  },
  containersTitle: { fontSize: 9, fontWeight: '700', color: '#38BDF8', letterSpacing: 0.8 },
  containerRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md,
    paddingHorizontal: Spacing.lg, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  containerIndexBadge: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(56,189,248,0.15)', borderWidth: 1, borderColor: 'rgba(56,189,248,0.3)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1,
  },
  containerIndexText: { fontSize: 9, fontWeight: '800', color: '#38BDF8' },
  containerNumber: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textPrimary, fontFamily: 'monospace' },
  containerMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  containerTag: {
    backgroundColor: 'rgba(56,189,248,0.12)', borderRadius: BorderRadius.full,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(56,189,248,0.25)',
  },
  containerTagText: { fontSize: 9, fontWeight: '700', color: '#38BDF8' },
  containerSeal: { fontSize: 10, color: Colors.textMuted, fontFamily: 'monospace' },

  // Fleet (multi-truck)
  fleetSectionLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fleetSectionIcon: {
    width: 20, height: 20, borderRadius: 6, backgroundColor: Colors.primaryGlow,
    alignItems: 'center', justifyContent: 'center',
  },
  fleetCountBadge: {
    backgroundColor: Colors.primaryGlow, borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
  },
  fleetCountText: { fontSize: 10, fontWeight: '700', color: Colors.primary },
  fleetCard: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  fleetRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.lg, paddingVertical: 11,
  },
  fleetRowPrimary: {
    backgroundColor: Colors.primaryGlow,
    borderBottomWidth: 1, borderBottomColor: 'rgba(47,129,247,0.15)',
  },
  fleetRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  fleetAvatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: Colors.primaryGlow, borderWidth: 1.5, borderColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  fleetAvatarText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  fleetAvatarAlt: { backgroundColor: Colors.surface, borderColor: Colors.border },
  fleetAvatarTextAlt: { color: Colors.textSecondary },
  fleetNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fleetPrimaryBadge: {
    backgroundColor: Colors.primary, borderRadius: BorderRadius.full,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  fleetPrimaryBadgeText: { fontSize: 9, fontWeight: '700', color: '#fff' },
  fleetTruckBadge: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.full,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: Colors.border,
  },
  fleetTruckBadgeText: { fontSize: 9, fontWeight: '600', color: Colors.textMuted },
  fleetName: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textPrimary, flex: 1 },
  fleetMeta: { fontSize: FontSize.xs, color: Colors.textMuted, fontFamily: 'monospace', marginTop: 2 },

  // Status picker modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'flex-end',
  },
  pickerSheet: {
    width: '100%', maxWidth: 500, alignSelf: 'center',
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl, borderTopRightRadius: BorderRadius.xl,
    borderWidth: 1, borderColor: Colors.border,
    paddingBottom: 24, overflow: 'hidden',
  },
  pickerHeader: {
    padding: Spacing.xl,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  pickerTitle: { fontSize: FontSize.base, fontWeight: '700', color: Colors.textPrimary },
  pickerSubtitle: { fontSize: FontSize.xs, color: Colors.textMuted, fontFamily: 'monospace', marginTop: 2 },
  pickerOption: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: 14,
  },
  pickerOptionBorder: {
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  pickerOptionActive: {
    backgroundColor: Colors.card,
  },
  pickerOptionIcon: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  pickerOptionText: {
    flex: 1, fontSize: FontSize.base, fontWeight: '500',
  },
  pickerCancel: {
    marginHorizontal: Spacing.xl, marginTop: 12,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    paddingVertical: 14, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  pickerCancelText: { fontSize: FontSize.base, fontWeight: '600', color: Colors.textSecondary },
  actionBtns: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 11, paddingVertical: 7,
    borderWidth: 1,
  },
  actionBtnText: { fontSize: FontSize.xs, fontWeight: '600' },
  emailBtn: {
    backgroundColor: 'rgba(210,153,34,0.12)', borderColor: 'rgba(210,153,34,0.35)',
  },
  emailBtnSent: {
    backgroundColor: Colors.successBg, borderColor: Colors.success,
  },
  emailBtnText: { color: Colors.warning },
  emailBtnTextSent: { color: Colors.success },
  shareBtn: {
    backgroundColor: Colors.primaryGlow, borderColor: 'rgba(47,129,247,0.3)',
  },
  shareBtnCopied: {
    backgroundColor: Colors.successBg, borderColor: Colors.success,
  },
  shareBtnText: { color: Colors.primary },
  shareBtnTextCopied: { color: Colors.success },

  // Chat section
  seaMapSectionLeft: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
  },
  seaMapSectionIcon: {
    width: 20, height: 20, borderRadius: 6, backgroundColor: 'rgba(88,196,220,0.15)',
    alignItems: 'center' as const, justifyContent: 'center' as const,
    borderWidth: 1, borderColor: 'rgba(88,196,220,0.3)',
  },
  vesselLiveBadge: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    backgroundColor: 'rgba(88,196,220,0.12)', borderRadius: BorderRadius.full,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(88,196,220,0.3)',
  },
  vesselLiveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.success },
  vesselLiveText: { fontSize: 9, fontWeight: '700' as const, color: '#58C4DC', letterSpacing: 0.8 },
  incotermsBadge: {
    backgroundColor: Colors.primaryGlow, borderRadius: BorderRadius.full,
    paddingHorizontal: 9, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(47,129,247,0.3)',
  },
  incotermsText: { fontSize: 11, fontWeight: '800' as const, color: Colors.primary },
  chatSectionLeft: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
  },
  chatSectionIcon: {
    width: 20, height: 20, borderRadius: 6, backgroundColor: Colors.primaryGlow,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  chatSectionRight: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
  },
  chatSectionPrivate: {
    fontSize: 10, color: Colors.success, fontWeight: '500' as const,
  },

  // Route History
  routeHistoryLeft: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, flex: 1 },
  routeHistoryRight: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  routeHistoryIcon: {
    width: 20, height: 20, borderRadius: 6, backgroundColor: `${Colors.success}18`,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  historyCountBadge: {
    backgroundColor: `${Colors.success}18`, borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: `${Colors.success}30`,
  },
  historyCountText: { fontSize: 10, fontWeight: '700' as const, color: Colors.success },
  historyMapToggle: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.full,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.border,
  },
  historyMapToggleActive: {
    backgroundColor: `${Colors.success}15`, borderColor: `${Colors.success}40`,
  },
  historyMapToggleText: { fontSize: 10, fontWeight: '600' as const, color: Colors.textMuted },
  historyMapWrap: { gap: Spacing.sm },
  historyMapLegend: {
    flexDirection: 'row' as const, gap: Spacing.xl,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  historyLegendItem: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  historyLegendLine: { width: 20, height: 3, borderRadius: 2 },
  historyLegendText: { fontSize: FontSize.xs, color: Colors.textSecondary },
  historyLoadingBox: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: Spacing.sm,
    justifyContent: 'center' as const, paddingVertical: Spacing.xl,
  },
  historyLoadingText: { fontSize: FontSize.sm, color: Colors.textMuted },
  historyEmptyBox: {
    alignItems: 'center' as const, gap: 6, paddingVertical: Spacing.xl,
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed' as const,
  },
  historyEmptyTitle: { fontSize: FontSize.sm, fontWeight: '600' as const, color: Colors.textMuted },
  historyEmptySub: {
    fontSize: FontSize.xs, color: Colors.textMuted,
    textAlign: 'center' as const, paddingHorizontal: Spacing.xl, lineHeight: 18,
  },
  historyTimelineWrap: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' as const,
  },
  historyStatsRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  historyStat: { flex: 1, alignItems: 'center' as const, gap: 3 },
  historyStatDivider: { width: 1, height: 28, backgroundColor: Colors.borderSubtle },
  historyStatValue: { fontSize: FontSize.sm, fontWeight: '700' as const },
  historyStatLabel: { fontSize: 9, color: Colors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  historyList: { maxHeight: 300 },
  historyRow: {
    flexDirection: 'row' as const, gap: Spacing.md,
    paddingHorizontal: Spacing.lg, paddingVertical: 10,
  },
  historyTimeline: { alignItems: 'center' as const, width: 16, paddingTop: 3 },
  historyTimelineDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: Colors.borderSubtle, borderWidth: 1.5, borderColor: Colors.border,
  },
  historyTimelineDotActive: {
    backgroundColor: Colors.success, borderColor: Colors.success,
  },
  historyTimelineLine: {
    flex: 1, width: 1.5, backgroundColor: Colors.borderSubtle, marginTop: 3,
  },
  historyRowContent: { flex: 1, gap: 4 },
  historyRowHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  historyTime: { fontSize: FontSize.sm, fontWeight: '600' as const, color: Colors.textPrimary, fontFamily: 'monospace' },
  historyDate: { fontSize: FontSize.xs, color: Colors.textMuted },
  latestBadge: {
    backgroundColor: `${Colors.success}18`, borderRadius: BorderRadius.full,
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: `${Colors.success}35`,
  },
  latestBadgeText: { fontSize: 9, fontWeight: '700' as const, color: Colors.success, letterSpacing: 0.5 },
  historyMeta: { flexDirection: 'row' as const, gap: Spacing.lg, flexWrap: 'wrap' as const },
  historyMetaItem: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 3 },
  historyMetaText: { fontSize: 10, color: Colors.textMuted, fontFamily: 'monospace' },
  historyMoreNote: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    justifyContent: 'center' as const,
    paddingVertical: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.borderSubtle,
  },
  historyMoreText: { fontSize: FontSize.xs, color: Colors.textMuted },
});
