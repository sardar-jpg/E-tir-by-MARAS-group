import { supabase } from './supabaseClient';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

export interface CargoDocument {
  id: string;
  shipmentId: string;
  driverId: string;
  fileUrl: string;
  fileName: string;
  fileType: 'image' | 'document';
  uploadedAt: string;
}

interface RawDoc {
  id: string;
  shipment_id: string;
  driver_id: string;
  file_url: string;
  file_name: string;
  file_type: string;
  uploaded_at: string;
}

function mapDoc(raw: RawDoc): CargoDocument {
  return {
    id: raw.id,
    shipmentId: raw.shipment_id,
    driverId: raw.driver_id,
    fileUrl: raw.file_url,
    fileName: raw.file_name,
    fileType: raw.file_type as 'image' | 'document',
    uploadedAt: raw.uploaded_at,
  };
}

/** Fetch all documents for a shipment */
export async function fetchShipmentDocuments(
  shipmentId: string
): Promise<{ docs: CargoDocument[]; error: string | null }> {
  const { data, error } = await supabase
    .from('cargo_documents')
    .select('*')
    .eq('shipment_id', shipmentId)
    .order('uploaded_at', { ascending: false });

  if (error) return { docs: [], error: error.message };
  return { docs: (data as RawDoc[]).map(mapDoc), error: null };
}

/**
 * Upload a cargo document/photo to Supabase Storage and save the record.
 * Mirrors the chat attachment upload pattern (base64 on native, File on web).
 */
export async function uploadCargoDocument(
  file: { uri: string; name: string; mimeType: string; rawFile?: File },
  shipmentId: string,
  driverId: string
): Promise<{ doc: CargoDocument | null; error: string | null }> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${driverId}/${shipmentId}/${Date.now()}_${safeName}`;
  const isImage = file.mimeType.startsWith('image/');

  try {
    let uploadData: File | Blob | Uint8Array;

    if (file.rawFile) {
      // Web: use the raw File object directly
      uploadData = file.rawFile;
    } else if (Platform.OS !== 'web') {
      // Native: base64 → Uint8Array (same pattern as chat attachments)
      const base64 = await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const binaryStr = atob(base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      uploadData = bytes;
    } else {
      const response = await fetch(file.uri);
      if (!response.ok) throw new Error(`Failed to read file: ${response.status}`);
      uploadData = await response.blob();
    }

    const { error: upErr } = await supabase.storage
      .from('cargo-documents')
      .upload(path, uploadData, { contentType: file.mimeType, upsert: false });

    if (upErr) return { doc: null, error: upErr.message };

    const { data: urlData } = supabase.storage
      .from('cargo-documents')
      .getPublicUrl(path);

    // Save record to DB
    const { data: dbData, error: dbErr } = await supabase
      .from('cargo_documents')
      .insert({
        shipment_id: shipmentId,
        driver_id: driverId,
        file_url: urlData.publicUrl,
        file_name: file.name,
        file_type: isImage ? 'image' : 'document',
      })
      .select()
      .single();

    if (dbErr) return { doc: null, error: dbErr.message };
    return { doc: mapDoc(dbData as RawDoc), error: null };
  } catch (e) {
    return { doc: null, error: String(e) };
  }
}

/** Delete a cargo document */
export async function deleteCargoDocument(docId: string): Promise<string | null> {
  const { error } = await supabase
    .from('cargo_documents')
    .delete()
    .eq('id', docId);
  return error?.message ?? null;
}
