import JSZip from 'jszip';
import { ShipmentDocument } from '../types';

export async function downloadDocumentsAsZip(shipmentNumber: string, documents: ShipmentDocument[]) {
  const zip = new JSZip();
  let addedCount = 0;
  
  for (const doc of documents) {
    if (!doc.url) continue;
    
    // Fallback file name
    const rawName = doc.name || 'document';
    const extension = doc.url.startsWith('data:image/') || doc.name?.match(/\.(jpeg|jpg|gif|png|webp)/i) ? '.png' : '.pdf';
    const fileName = rawName.includes('.') ? rawName : `${rawName}${extension}`;
    
    if (doc.url.startsWith('data:')) {
      // Decode inline base64 uploaded custom driver documents and images
      try {
        const parts = doc.url.split(',');
        if (parts.length > 1) {
          const base64Data = parts[1];
          zip.file(fileName, base64Data, { base64: true });
          addedCount++;
        }
      } catch (err) {
        console.error("Failed to decode base64 file:", fileName, err);
        zip.file(fileName, `Decoding error: could not extract binary resource data.`);
        addedCount++;
      }
    } else if (doc.url !== '#' && doc.url.startsWith('http')) {
      // Fetch actual active storage URLs
      try {
        const response = await fetch(doc.url);
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          zip.file(fileName, buffer);
          addedCount++;
        } else {
          zip.file(fileName, `Failed to retrieve resource. Server returned HTTP ${response.status}`);
          addedCount++;
        }
      } catch (err) {
        console.error("CORS / Network block fetching file:", doc.url, err);
        zip.file(fileName, `Asset source online backup link: ${doc.url} (CORS fetch blocked)`);
        addedCount++;
      }
    } else {
      // Offline fallback document placeholder
      zip.file(fileName, `Official TIR electronic record backup ledger for shipment #${shipmentNumber}.\nUploaded by: ${doc.uploadedBy || 'Dispatcher'}\nCategory: ${doc.category || 'other'}\nTimestamp: ${doc.uploadedAt || new Date().toISOString()}`);
      addedCount++;
    }
  }

  if (addedCount === 0) {
    zip.file("empty_manifest.txt", "No attachments or document assets found.");
  }
  
  const blob = await zip.generateAsync({ type: 'blob' });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = `shipment_${shipmentNumber}_all_documents.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(downloadUrl);
}
