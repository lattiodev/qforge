import { Buffer } from 'buffer';
import base64 from 'base-64';
import { QubicTransaction } from "@qubic-lib/qubic-ts-library/dist/qubic-types/QubicTransaction";
import { DynamicPayload } from "@qubic-lib/qubic-ts-library/dist/qubic-types/DynamicPayload";
import { Signature } from "@qubic-lib/qubic-ts-library/dist/qubic-types/Signature";
import { PublicKey } from "@qubic-lib/qubic-ts-library/dist/qubic-types/PublicKey";
import { Long } from "@qubic-lib/qubic-ts-library/dist/qubic-types/Long";
import { PUBLIC_KEY_LENGTH, SIGNATURE_LENGTH } from "@qubic-lib/qubic-ts-library/dist/crypto";

// Contract indexes mapping - now imported from context
export const CONTRACT_INDEXES = {
  'QX': 1,
  'Qx': 1,
  'QUOTTERY': 2,
  'Quottery': 2,
  'RANDOM': 3,
  'Random': 3,
  'QUTIL': 4,
  'QUtil': 4,
  'MLM': 5,
  'Mlm': 5,
  'GQMPROP': 6,
  'Gqmprop': 6,
  'SWATCH': 7,
  'Swatch': 7,
  'CCF': 8,
  'Ccf': 8,
  'QEARN': 9,
  'Qearn': 9,
  'QVAULT': 10,
  'Qvault': 10,
  'MSVAULT': 11,
  'Msvault': 11,
  'HM25': 12,
  'Hm25': 12,
};

// Helper function to get contract index
export function getContractIndex(contractName, customIndexes = null) {
  const indexes = customIndexes || CONTRACT_INDEXES;
  const upperContractName = contractName.toUpperCase();
  const contractsFound = Object.keys(indexes).filter(key => 
    key.toUpperCase() === upperContractName
  );
  
  if (contractsFound.length > 0) {
    return indexes[contractsFound[0]];
  }
  
  // Fallback to hash if not found
  return contractName.split('').reduce((a, b) => a + b.charCodeAt(0), 0) % 100;
}

// Parse contract content
export function parseContract(content) {
  const contractStructRegex = /struct\s+([A-Za-z0-9_]+)\s*:\s*public\s+ContractBase/g;
  let contractName = null;
  const structMatch = contractStructRegex.exec(content);
  if (structMatch) {
    contractName = structMatch[1];
  }
  
  const regex = /REGISTER_USER_(FUNCTION|PROCEDURE)\(\s*([A-Za-z0-9_]+)\s*,\s*(\d+)\s*\)/g;
  const functions = [];
  let match;

  while ((match = regex.exec(content)) !== null) {
    const fnName = match[2];
    const inputs = parseParameters(content, fnName, 'input');
    const outputs = parseParameters(content, fnName, 'output');
    
    functions.push({
      type: match[1] === 'FUNCTION' ? 'view' : 'transaction',
      name: fnName,
      index: parseInt(match[3], 10),
      inputs,
      outputs,
    });
  }
  
  return { contractName, functions };
}

// Generic Parameter Parser (handles both input and output)
function parseParameters(content, functionName, direction) {
  const regexStruct = new RegExp(`struct\\s+${functionName}_${direction}\\s*\\{([^}]+)\\}`, 's'); // Use 's' flag for multiline
  const structMatch = regexStruct.exec(content);
  
  if (structMatch) {
    const structBody = structMatch[1];
    // Regex to match field declarations including basic types, char arrays, and Array<type, size>
    const fieldRegex = /(?:(Array<([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_]+)>)|([a-zA-Z0-9_]+(?:\[\d+\])?))\s+([a-zA-Z0-9_]+)\s*;/g;
    let fieldMatch;
    const fields = [];
    
    while ((fieldMatch = fieldRegex.exec(structBody)) !== null) {
        if (fieldMatch[1]) { // Matched Array<type, size>
            fields.push({
                type: 'Array',
                elementType: fieldMatch[2],
                size: fieldMatch[3], // Keep size as string for now, might be constant name
                name: fieldMatch[5],
            });
        } else { // Matched basic type or char[]
             fields.push({
                type: fieldMatch[4], // e.g., "uint64" or "char[64]"
                name: fieldMatch[5],
            });
        }
    }
    return fields;
  }
  
  const typedefRegex = new RegExp(`typedef\\s+([A-Za-z0-9_<>]+)\\s+${functionName}_${direction}`, 'g');
  const typedefMatch = typedefRegex.exec(content);
  
  if (typedefMatch) {
    const referencedType = typedefMatch[1];
    if (referencedType === 'ProposalDataT') {
      return [{
        type: 'ProposalDataT',
        name: 'proposalData',
        description: 'JSON structure with type and transfer fields'
      }];
    }
    return [{
      type: referencedType,
      name: 'data',
      description: 'JSON structure for this complex type'
    }];
  }
  
  return [];
}

// Helper function to encode a single value based on type
function encodeValue(value, type, qHelper, size = 0) {
    let buffer;
    const isAmountField = false; // Assuming amount scaling is handled elsewhere
    const scaleAmount = (val) => BigInt(val || 0) * 1000000n;

    if (type === 'uint8') {
        buffer = Buffer.alloc(1);
        buffer.writeUInt8(parseInt(value || 0), 0);
    } else if (type === 'uint16') {
        buffer = Buffer.alloc(2);
        buffer.writeUInt16LE(parseInt(value || 0), 0);
    } else if (type === 'uint32') {
        buffer = Buffer.alloc(4);
        buffer.writeUInt32LE(parseInt(value || 0), 0);
    } else if (type === 'uint64') {
        buffer = Buffer.alloc(8);
        const valToEncode = isAmountField ? scaleAmount(value) : BigInt(value || 0);
        buffer.writeBigUInt64LE(valToEncode, 0);
    } else if (type === 'int8' || type === 'sint8') {
        buffer = Buffer.alloc(1);
        buffer.writeInt8(parseInt(value || 0), 0);
    } else if (type === 'int16' || type === 'sint16') {
        buffer = Buffer.alloc(2);
        buffer.writeInt16LE(parseInt(value || 0), 0);
    } else if (type === 'int32' || type === 'sint32') {
        buffer = Buffer.alloc(4);
        buffer.writeInt32LE(parseInt(value || 0), 0);
    } else if (type === 'int64' || type === 'sint64') {
        buffer = Buffer.alloc(8);
        const valToEncode = isAmountField ? scaleAmount(value) : BigInt(value || 0);
        buffer.writeBigInt64LE(valToEncode, 0);
    } else if (type === 'id') {
        buffer = Buffer.alloc(PUBLIC_KEY_LENGTH); // 32 bytes
        if (!qHelper) {
            console.error("qHelper instance not provided to encodeValue for ID type!");
            buffer.fill(0);
        } else {
            try {
                const idBytes = qHelper.getIdentityBytes(value); // Use qHelper method
                if (idBytes && idBytes.length === PUBLIC_KEY_LENGTH) {
                    Buffer.from(idBytes).copy(buffer); // Ensure it's copied correctly
                } else {
                    console.warn(`Invalid ID format or length for value: ${value}. Using zero buffer.`);
                    buffer.fill(0);
                }
            } catch (error) {
                 console.error(`Error converting ID "${value}" to bytes:`, error);
                 buffer.fill(0);
            }
        }
    } else if (type === 'bit' || type === 'bool') {
        buffer = Buffer.alloc(1);
        buffer.writeUInt8(value ? 1 : 0, 0);
    } else if (type.startsWith('char[')) {
        const sizeMatch = type.match(/\[(\d+)\]/);
        const charSize = sizeMatch ? parseInt(sizeMatch[1], 10) : size || 64; // Use provided size or default
        buffer = Buffer.alloc(charSize);
        const strBuffer = Buffer.from(String(value || ''), 'utf-8');
        strBuffer.copy(buffer, 0, 0, Math.min(strBuffer.length, charSize));
        // Ensure remaining bytes are zero-filled if string is shorter than size
        if (strBuffer.length < charSize) {
            buffer.fill(0, strBuffer.length);
        }
    } else {
        console.warn(`Unsupported type for encoding: ${type}. Returning empty buffer.`);
        buffer = Buffer.alloc(0);
    }
    return buffer;
}

// Encode parameters for contract calls
export function encodeParams(params, inputFields = [], qHelper) {
  try {
    if (!params || Object.keys(params).length === 0 || inputFields.length === 0) return '';

    const buffers = [];
    let totalSize = 0;

    // Resolve constants like MSVAULT_MAX_OWNERS (simplistic - assumes global consts or manual mapping)
    const resolveSize = (sizeStr) => {
        if (/^\d+$/.test(sizeStr)) return parseInt(sizeStr, 10);
        // Add known constants here
        const knownConstants = {
            'MSVAULT_MAX_OWNERS': 16,
            'MSVAULT_MAX_COOWNER': 8,
            '1024': 1024, // Handle direct numbers
             // Add more constants from contracts as needed
        };
        return knownConstants[sizeStr] || 0; // Default to 0 if unknown constant
    };

    inputFields.forEach(field => {
      const value = params[field.name];

      if (field.type === 'Array') {
          let items = [];
          if (typeof value === 'string') {
              try { items = JSON.parse(value); } catch (e) { console.error(`Invalid JSON for array field ${field.name}:`, value); items = []; }
          } else if (Array.isArray(value)) {
              items = value;
          }

          const arraySize = resolveSize(field.size);
          if (arraySize === 0) {
              console.warn(`Could not resolve size for array ${field.name} (size: ${field.size}). Skipping field.`);
              return; // Skip this field if size is unresolved
          }

          for (let i = 0; i < arraySize; i++) {
              const itemValue = items[i] !== undefined ? items[i] : null; // Get item or null if out of bounds
              // Pass qHelper to encodeValue
              const itemBuffer = encodeValue(itemValue, field.elementType, qHelper);
              buffers.push(itemBuffer);
              totalSize += itemBuffer.length;
          }

      } else if (field.type === 'ProposalDataT' || field.type === 'ProposalDataYesNo') {
           // Handle complex Proposal types (simplified placeholder)
           console.warn(`Complex type ${field.type} encoding not fully implemented here.`);
           const complexBuffer = Buffer.alloc(0); // Or call a specific encoder
           buffers.push(complexBuffer);
           totalSize += complexBuffer.length;

      } else {
          // Pass qHelper to encodeValue
          const fieldBuffer = encodeValue(value, field.type, qHelper);
          buffers.push(fieldBuffer);
          totalSize += fieldBuffer.length;
      }
    });

    const finalBuffer = Buffer.concat(buffers, totalSize);
    return base64.encode(String.fromCharCode(...new Uint8Array(finalBuffer)));

  } catch (error) {
    console.error("Error encoding parameters:", error);
    return '';
  }
}

// Helper to decode a single value
function decodeValue(dv, offset, type, size = 0) {
    let value;
    let fieldSize = 0;

    if (type.includes('uint64') || type.includes('sint64')) {
        fieldSize = 8;
        if (offset + fieldSize <= dv.byteLength) {
            value = type.includes('uint')
                ? dv.getBigUint64(offset, true).toString()
                : dv.getBigInt64(offset, true).toString();
        }
    } else if (type.includes('id')) { // Treat ID like uint64 for display, maybe add specific ID formatting later
         fieldSize = PUBLIC_KEY_LENGTH; // 32 bytes raw
         if (offset + fieldSize <= dv.byteLength) {
             const idBytes = new Uint8Array(dv.buffer, dv.byteOffset + offset, fieldSize);
             // Placeholder: Return hex for now, needs ID conversion helper for readable format
             value = Buffer.from(idBytes).toString('hex');
             // Example: value = qubicHelper.getIdStringFromBytes(idBytes); // If helper available
         }
    } else if (type.includes('uint32') || type.includes('sint32')) {
        fieldSize = 4;
        if (offset + fieldSize <= dv.byteLength) {
            value = type.includes('uint')
                ? dv.getUint32(offset, true)
                : dv.getInt32(offset, true);
        }
    } else if (type.includes('uint16') || type.includes('sint16')) {
        fieldSize = 2;
        if (offset + fieldSize <= dv.byteLength) {
            value = type.includes('uint')
                ? dv.getUint16(offset, true)
                : dv.getInt16(offset, true);
        }
    } else if (type.includes('uint8') || type.includes('sint8')) {
        fieldSize = 1;
        if (offset + fieldSize <= dv.byteLength) {
            value = type.includes('uint') ? dv.getUint8(offset) : dv.getInt8(offset);
        }
    } else if (type === 'bit' || type === 'bool') {
        fieldSize = 1;
        if (offset + fieldSize <= dv.byteLength) {
            value = dv.getUint8(offset) !== 0;
        }
    } else if (type.startsWith('char[')) {
        const sizeMatch = type.match(/\[(\d+)\]/);
        fieldSize = sizeMatch ? parseInt(sizeMatch[1], 10) : size || 64; // Use provided size or default
         if (offset + fieldSize <= dv.byteLength) {
             const charBytes = new Uint8Array(dv.buffer, dv.byteOffset + offset, fieldSize);
             // Find the first null terminator
             const nullIndex = charBytes.indexOf(0);
             const effectiveLength = nullIndex !== -1 ? nullIndex : fieldSize;
             value = Buffer.from(charBytes.slice(0, effectiveLength)).toString('utf-8');
         }
    } else {
         console.warn(`Unsupported type for decoding: ${type}. Skipping.`);
         value = `[Unsupported Type: ${type}]`;
         fieldSize = 0; // Cannot determine size
    }

    if (value === undefined) {
        value = `[Buffer short]`
    }

    return { value, readSize: fieldSize };
}

// Decode contract response
export function decodeContractResponse(responseData, outputFields) {
  if (!responseData) {
    return { 
      success: true,
      message: "No data returned from contract"
    };
  }
  
  try {
    const binary = base64.decode(responseData);
    const buffer = Buffer.from(binary, 'binary');
    const dv = new DataView(buffer.buffer);
    const hexDump = [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join(' ');
    
    // Resolve constants for array sizes in outputs
    const resolveSize = (sizeStr) => {
        if (/^\d+$/.test(sizeStr)) return parseInt(sizeStr, 10);
        const knownConstants = {
            'MSVAULT_MAX_OWNERS': 16,
            'MSVAULT_MAX_COOWNER': 8,
            // Add other constants used in output array sizes if any
            '1024': 1024, // Handle direct numbers in definitions like Array<uint32, 1024>
        };
        const resolved = knownConstants[sizeStr];
        if (resolved === undefined) {
             console.warn(`Could not resolve constant size "${sizeStr}" for output array.`);
        }
        return resolved || 0;
    };

    if (outputFields && outputFields.length > 0) {
      const result = {};
      let offset = 0;
      
      for (const field of outputFields) {
        const { name, type } = field;
        
        if (offset >= buffer.length) {
          result[name] = `[Buffer end reached before field: ${name}]`;
          continue;
        }
        
        if (type === 'Array') {
            const arraySize = resolveSize(field.size);
            if (arraySize === 0) {
                 result[name] = `[Could not determine size for array: ${name}]`;
                 continue;
            }
            const items = [];
            let currentOffset = offset;
            for (let i = 0; i < arraySize; i++) {
                 if (currentOffset >= buffer.length) {
                     items.push(`[Buffer end reached in array at index ${i}]`);
                     break;
                 }
                 const { value: itemValue, readSize: itemSize } = decodeValue(dv, currentOffset, field.elementType);
                 items.push(itemValue);
                 currentOffset += itemSize;
                 if (itemSize === 0) { // If decodeValue couldn't determine size, stop array processing
                      console.warn(`Could not determine size for element type ${field.elementType} in array ${name}. Stopping array decode.`);
                      break;
                 }
            }
            result[name] = items;
            offset = currentOffset; // Update main offset

        } else {
             const { value, readSize } = decodeValue(dv, offset, type);
             result[name] = value;
             offset += readSize;
             if (readSize === 0) { // Stop processing if size is unknown
                 console.warn(`Could not determine size for type ${type} (${name}). Stopping decode.`);
                 break;
             }
        }
      }
      
      return {
        success: true,
        decodedFields: result,
        rawHex: hexDump,
        byteLength: buffer.length
      };
    }
    
    return decodeGenericResponse(buffer, dv, hexDump);
  } catch (error) {
    console.error('Error decoding contract response:', error);
    return {
      success: false,
      error: error.message,
      rawData: responseData
    };
  }
}

// Helper function for generic response decoding
function decodeGenericResponse(buffer, dv, hexDump) {
  const result = {};
  
  if (buffer.length % 8 === 0 && buffer.length > 0) {
    const numValues = buffer.length / 8;
    for (let i = 0; i < numValues; i++) {
      try {
        result[`field${i+1}`] = dv.getBigUint64(i * 8, true).toString();
      } catch (e) {
        const low = dv.getUint32(i * 8, true);
        const high = dv.getUint32(i * 8 + 4, true);
        result[`field${i+1}`] = (high * Math.pow(2, 32) + low).toString();
      }
    }
  } else if (buffer.length % 4 === 0 && buffer.length > 0) {
    const numValues = buffer.length / 4;
    for (let i = 0; i < numValues; i++) {
      result[`field${i+1}`] = dv.getUint32(i * 4, true);
    }
  } else if (buffer.length % 2 === 0 && buffer.length > 0) {
    const numValues = buffer.length / 2;
    for (let i = 0; i < numValues; i++) {
      result[`field${i+1}`] = dv.getUint16(i * 2, true);
    }
  } else {
    for (let i = 0; i < buffer.length; i++) {
      result[`field${i+1}`] = dv.getUint8(i);
    }
  }
  
  return {
    success: true,
    decodedFields: result,
    rawHex: hexDump,
    byteLength: buffer.length
  };
}

// Convert Uint8Array to hex string
export const byteArrayToHexString = (byteArray) => {
    if (!byteArray) return '';
    // Use Buffer.from to handle ArrayBuffer directly if byteArray is Uint8Array
    return Buffer.from(byteArray).toString('hex');
};

export function base64ToUint8Array(base64) {
    try {
        const binaryString = atob(base64); // Use built-in atob
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    } catch (e) {
        console.error("Error decoding Base64 string:", e, "Input:", base64.substring(0, 50) + "...");
        throw new Error("Invalid Base64 string provided.");
    }
}

export function decodeUint8ArrayTx(tx) {
    if (!(tx instanceof Uint8Array)) {
        throw new Error("Invalid input: tx must be a Uint8Array.");
    }
    
    const newTx = new QubicTransaction();

    // Calculate sizes and offsets more robustly
    const SRC_PUBKEY_END = PUBLIC_KEY_LENGTH;
    const DEST_PUBKEY_END = SRC_PUBKEY_END + PUBLIC_KEY_LENGTH;
    const AMOUNT_END = DEST_PUBKEY_END + 8;
    const TICK_END = AMOUNT_END + 4;
    const INPUT_TYPE_END = TICK_END + 2;
    const INPUT_SIZE_END = INPUT_TYPE_END + 2;

    if (tx.length < INPUT_SIZE_END) {
        throw new Error(`Transaction buffer too short for header fields. Need ${INPUT_SIZE_END}, got ${tx.length}`);
    }

    const inputSize = new DataView(tx.buffer, tx.byteOffset + INPUT_TYPE_END, 2).getUint16(0, true);
    const payloadStart = INPUT_SIZE_END;
    const payloadEnd = payloadStart + inputSize;
    const signatureStart = payloadEnd;
    const signatureEnd = signatureStart + SIGNATURE_LENGTH;

    if (tx.length < signatureEnd) {
         throw new Error(`Transaction buffer too short for payload and signature. Need ${signatureEnd}, got ${tx.length}`);
    }

    // Use try-catch blocks for robustness during decoding
    try {
        newTx.setSourcePublicKey(
            new PublicKey(tx.slice(0, SRC_PUBKEY_END))
        );
        newTx.setDestinationPublicKey(
            new PublicKey(tx.slice(SRC_PUBKEY_END, DEST_PUBKEY_END))
        );
        newTx.setAmount(new Long(tx.slice(DEST_PUBKEY_END, AMOUNT_END)));
        newTx.setTick(new DataView(tx.buffer, tx.byteOffset + AMOUNT_END, 4).getUint32(0, true));
        newTx.setInputType(new DataView(tx.buffer, tx.byteOffset + TICK_END, 2).getUint16(0, true));
        newTx.setInputSize(inputSize);

        if (inputSize > 0) {
            const payload = new DynamicPayload(inputSize);
            payload.setPayload(tx.slice(payloadStart, payloadEnd));
            newTx.setPayload(payload);
        } else {
             newTx.setPayload(new DynamicPayload(0));
        }

        newTx.signature = new Signature(tx.slice(signatureStart, signatureEnd));

        return newTx;
    } catch (error) {
        console.error("Error during transaction decoding:", error);
        throw new Error(`Failed to decode transaction structure: ${error.message}`);
    }
} 