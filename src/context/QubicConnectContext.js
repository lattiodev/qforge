// src/context/QubicConnectContext.js
import React, { createContext, useContext, useState, useEffect } from 'react';
import { QubicHelper } from '@qubic-lib/qubic-ts-library/dist/qubicHelper';
import Crypto, { SIGNATURE_LENGTH } from '@qubic-lib/qubic-ts-library/dist/crypto';
import base64 from 'base-64';
import { Buffer } from 'buffer';
import { QubicVault } from "@qubic-lib/qubic-ts-vault-library";
import SignClient from "@walletconnect/sign-client";
import QRCode from "qrcode";
import { decodeUint8ArrayTx, base64ToUint8Array, uint8ArrayToBase64 } from "../utils/contractUtils";

// Helper function to sign transactions
async function localSignTx(qHelper, privateKey, tx) {
  const qCrypto = await Crypto;
  const idPackage = await qHelper.createIdPackage(privateKey);

  const digest = new Uint8Array(qHelper.DIGEST_LENGTH);
  const toSign = tx.slice(0, tx.length - SIGNATURE_LENGTH);

  qCrypto.K12(toSign, digest, qHelper.DIGEST_LENGTH);

  const signature = qCrypto.schnorrq.sign(
    idPackage.privateKey,
    idPackage.publicKey,
    digest
  );

  tx.set(signature, tx.length - SIGNATURE_LENGTH);
  return tx;
}

// Default contract indexes for mainnet
const DEFAULT_CONTRACT_INDEXES = {
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
  'QBAY': 12,
  'Qbay': 12,
  'NOSTROMO': 13,
  'Nostromo': 13,
};

// Predefined RPC configurations
export const RPC_CONFIGS = {
  'https://rpc.qubic.org': {
    name: 'Mainnet',
    indexes: DEFAULT_CONTRACT_INDEXES
  },
  'https://testnet-rpc.qubicdev.com': {
    name: 'Testnet',
    indexes: {
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
      'QSWAP': 9,
      'Qswap': 9,
      'QVAULT': 10,
      'Qvault': 10,
      'MSVAULT': 11,
      'Msvault': 11,
      'QBAY': 12,
      'Qbay': 12,
      'Qswap': 13,
      'QSWAP': 13,
      // Add your testnet-specific contract indexes here
    }
  }
};

const QubicConnectContext = createContext(null);

// Constants for WalletConnect
const WC_PROJECT_ID = process.env.REACT_APP_WC_PROJECT_ID || "b2ace378845f0e4806ef23d2732f77a4";
const WC_RELAY_URL = process.env.REACT_APP_WC_RELAY_URL || "wss://relay.walletconnect.com";
const WC_METADATA = {
    name: 'Dynamic Contract UI',
    description: 'Interact with Qubic Smart Contracts',
    url: window.location.origin,
    icons: [window.location.origin + '/logo192.png']
};
const WC_CHAIN_ID = 'qubic:mainnet';

// Constants for MetaMask Snap
const SNAP_ORIGIN = process.env.REACT_APP_SNAP_ORIGIN || 'npm:@qubic-lib/qubic-mm-snap';
const SNAP_VERSION = process.env.REACT_APP_SNAP_VERSION;

export function QubicConnectProvider({ children }) {
  const [connected, setConnected] = useState(false);
  const [wallet, setWallet] = useState(null);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmTxDetails, setConfirmTxDetails] = useState(null);
  const [confirmTxCallbacks, setConfirmTxCallbacks] = useState({});
  const [qHelper] = useState(() => new QubicHelper());
  const [vault] = useState(() => new QubicVault());

  const [wcClient, setWcClient] = useState(null);
  const [wcSession, setWcSession] = useState(null);
  const [wcUri, setWcUri] = useState('');
  const [wcQrCode, setWcQrCode] = useState('');
  const [wcIsConnecting, setWcIsConnecting] = useState(false);

  const [mmInstalledSnap, setMmInstalledSnap] = useState(null);
  const [mmIsConnecting, setMmIsConnecting] = useState(false);
  const [mmError, setMmError] = useState(null);

  const [httpEndpoint, setHttpEndpoint] = useState(
    process.env.REACT_APP_HTTP_ENDPOINT || 'https://rpc.qubic.org'
  );

  // --- Add Balance State --- 
  const [balance, setBalance] = useState(null);
  const [isBalanceLoading, setIsBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState(null);

  // --- Add Owned Assets State --- 
  const [ownedAssets, setOwnedAssets] = useState([]);
  const [isAssetsLoading, setIsAssetsLoading] = useState(false);
  const [assetsError, setAssetsError] = useState(null);

  // --- Add Possessed Assets State --- 
  const [possessedAssets, setPossessedAssets] = useState([]);
  const [isPossessedAssetsLoading, setIsPossessedAssetsLoading] = useState(false);
  const [possessedAssetsError, setPossessedAssetsError] = useState(null);

  const [contractIndexes, setContractIndexes] = useState(DEFAULT_CONTRACT_INDEXES);

  useEffect(() => {
    const initializeWcClient = async () => {
        try {
            const client = await SignClient.init({
                projectId: WC_PROJECT_ID,
                relayUrl: WC_RELAY_URL,
                metadata: WC_METADATA,
            });
            setWcClient(client);

            if (client.session.length) {
                const lastKeyIndex = client.session.keys.length - 1;
                const session = client.session.get(client.session.keys[lastKeyIndex]);
                setWcSession(session);
                connect({
                    connectType: "walletconnect",
                    publicKey: session.namespaces.qubic.accounts[0].split(':')[2],
                    wcSession: session,
                }, true);
            }

            client.on('session_event', (event) => {
                console.log('WC Event:', event);
            });

            client.on('session_update', ({ topic, params }) => {
                const { namespaces } = params;
                const _session = client.session.get(topic);
                const updatedSession = { ..._session, namespaces };
                setWcSession(updatedSession);
                const publicKey = updatedSession.namespaces.qubic.accounts[0].split(':')[2];
                if (wallet?.connectType === 'walletconnect' && wallet.publicKey !== publicKey) {
                     connect({ connectType: "walletconnect", publicKey, wcSession: updatedSession });
                }
            });

            client.on('session_delete', () => {
                setWcSession(null);
                if (wallet?.connectType === 'walletconnect') {
                    disconnect();
                }
            });

        } catch (e) {
            console.error("Failed to initialize WalletConnect client:", e);
        }
    };

    initializeWcClient();

    const saved = localStorage.getItem("wallet");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.connectType !== 'walletconnect') {
            setWallet(parsed);
            setConnected(true);
        }
      } catch (error) {
        if (typeof saved === 'string' && saved.length === 55 && saved.match(/^[a-z]+$/)) {
            connect({
              connectType: "privateKey",
              privateKey: saved
            });
        } else {
             localStorage.removeItem("wallet");
        }
      }
    }

    const checkForSnap = async () => {
      try {
        const installed = await getSnap();
        setMmInstalledSnap(installed);
      } catch (e) {
        console.log("MetaMask Snap not found or error checking:", e);
        setMmInstalledSnap(null);
      }
    };
    if (window.ethereum?.isMetaMask) {
       checkForSnap();
    }

    const savedEndpoint = localStorage.getItem("httpEndpoint");
    if (savedEndpoint) {
      setHttpEndpoint(savedEndpoint);
    }

    // Load saved contract indexes from localStorage
    const savedIndexes = localStorage.getItem('contractIndexes');
    if (savedIndexes) {
      try {
        setContractIndexes(JSON.parse(savedIndexes));
      } catch (e) {
        console.error('Failed to load saved contract indexes:', e);
      }
    }
  }, []);

  // --- Add Effect to Fetch Balance --- 
  useEffect(() => {
    const fetchBalance = async () => {
        if (!connected || !wallet?.publicKey || !httpEndpoint) {
            setBalance(null);
            setIsBalanceLoading(false);
            setBalanceError(null);
            return;
        }

        console.log(`Fetching balance for ${wallet.publicKey} from ${httpEndpoint} using /v1/balances`);
        setIsBalanceLoading(true);
        setBalanceError(null);
        setBalance(null); 

        try {
            // Use the correct endpoint: /v1/balances/{id}
            const response = await fetch(`${httpEndpoint}/v1/balances/${wallet.publicKey}`);
            if (!response.ok) {
                 const errorText = await response.text();
                throw new Error(`HTTP error ${response.status}: ${errorText || response.statusText}`);
            }
            const data = await response.json();
            
            // *** ADD LOGGING HERE ***
            console.log("[QubicConnectContext] Raw balance API response:", JSON.stringify(data)); 
            
            // Parse response according to the provided structure
            if (data && data.balance && data.balance.balance !== undefined && data.balance.balance !== null) {
                 const rawBalance = data.balance.balance.toString(); // Ensure it's a string
                 console.log("[QubicConnectContext] Parsed raw balance (QUs):", rawBalance); // Log the value being set
                setBalance(rawBalance);
            } else {
                console.warn("Balance field (data.balance.balance) not found in API response:", data);
                 setBalance('0'); // Default to 0 if structure is unexpected
            }
        } catch (error) {
            console.error("Failed to fetch balance:", error);
            setBalanceError(error.message);
            setBalance(null);
        } finally {
            setIsBalanceLoading(false);
        }
    };

    fetchBalance();

  }, [connected, wallet?.publicKey, httpEndpoint]); // Re-run on change

  // --- Add Effect to Fetch Owned Assets ---
  useEffect(() => {
    const fetchOwnedAssets = async () => {
      if (!connected || !wallet?.publicKey || !httpEndpoint) {
        setOwnedAssets([]);
        setIsAssetsLoading(false);
        setAssetsError(null);
        return;
      }

      console.log(`Fetching owned assets for ${wallet.publicKey} from ${httpEndpoint} using /v1/assets/${wallet.publicKey}/owned`);
      setIsAssetsLoading(true);
      setAssetsError(null);
      setOwnedAssets([]);

      try {
        const response = await fetch(`${httpEndpoint}/v1/assets/${wallet.publicKey}/owned`);
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP error ${response.status}: ${errorText || response.statusText}`);
        }
        const data = await response.json();

        // Assuming the API returns an object with an 'ownedAssets' array
        if (data && Array.isArray(data.ownedAssets)) {
          console.log("Owned assets received:", data.ownedAssets);
          setOwnedAssets(data.ownedAssets); 
        } else {
          console.warn("Owned assets field ('ownedAssets') not found or not an array in API response:", data);
          setOwnedAssets([]); // Default to empty array if structure is unexpected
        }
      } catch (error) {
        console.error("Failed to fetch owned assets:", error);
        setAssetsError(error.message);
        setOwnedAssets([]);
      } finally {
        setIsAssetsLoading(false);
      }
    };

    fetchOwnedAssets();

  }, [connected, wallet?.publicKey, httpEndpoint]); // Re-run on change

  // --- Add Effect to Fetch Possessed Assets ---
  useEffect(() => {
    const fetchPossessedAssets = async () => {
      if (!connected || !wallet?.publicKey || !httpEndpoint) {
        setPossessedAssets([]);
        setIsPossessedAssetsLoading(false);
        setPossessedAssetsError(null);
        return;
      }

      console.log(`Fetching possessed assets for ${wallet.publicKey} from ${httpEndpoint} using /v1/assets/${wallet.publicKey}/possessed`);
      setIsPossessedAssetsLoading(true);
      setPossessedAssetsError(null);
      setPossessedAssets([]);

      try {
        const response = await fetch(`${httpEndpoint}/v1/assets/${wallet.publicKey}/possessed`);
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP error ${response.status}: ${errorText || response.statusText}`);
        }
        const data = await response.json();

        // Assuming the API returns an object with a 'possessedAssets' array
        if (data && Array.isArray(data.possessedAssets)) {
          console.log("Possessed assets received:", data.possessedAssets);
          setPossessedAssets(data.possessedAssets); 
        } else {
          console.warn("Possessed assets field ('possessedAssets') not found or not an array in API response:", data);
          setPossessedAssets([]); // Default to empty array
        }
      } catch (error) {
        console.error("Failed to fetch possessed assets:", error);
        setPossessedAssetsError(error.message);
        setPossessedAssets([]);
      } finally {
        setIsPossessedAssetsLoading(false);
      }
    };

    fetchPossessedAssets();

  }, [connected, wallet?.publicKey, httpEndpoint]); // Re-run on change

  // Save contract indexes to localStorage when they change
  useEffect(() => {
    localStorage.setItem('contractIndexes', JSON.stringify(contractIndexes));
  }, [contractIndexes]);

  function uint8ArrayToBase64(uint8Array) {
    const binaryString = String.fromCharCode.apply(null, uint8Array);
    return btoa(binaryString);
  }

  const broadcastTx = async (tx, endpoint) => {
    const targetEndpoint = endpoint || httpEndpoint;
    const url = `${targetEndpoint}/v1/broadcast-transaction`;
    
    const txEncoded = uint8ArrayToBase64(tx);
    
    const body = { encodedTransaction: txEncoded };
    
    try {
      console.log(`Broadcasting TX to: ${targetEndpoint}`);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
      }
      
      const result = await response.json();
      console.log("Broadcast result:", result);
      return result;
    } catch (error) {
      console.error('Error broadcasting transaction:', error);
      throw error;
    }
  };

  const signTxWithFaucetKey = async (faucetSeed, tx) => {
      if (!faucetSeed || faucetSeed.length !== 55) {
          throw new Error("Invalid or missing faucet seed.");
      }
      const faucetQHelper = new QubicHelper(); 
      return await localSignTx(faucetQHelper, faucetSeed, tx);
  };

  const getTick = async () => {
    try {
      const url = `${httpEndpoint}/v1/tick-info`;
      console.log(`[getTick] Fetching tick info from ${url}`);
      const tickResult = await fetch(url);
      
      if (!tickResult.ok) {
          const errorText = await tickResult.text();
           console.error(`[getTick] HTTP error ${tickResult.status}: ${errorText}`);
           throw new Error(`Failed to fetch tick info: HTTP ${tickResult.status}`);
      }
      
      const tickData = await tickResult.json();
      console.log(`[getTick] Received tick data:`, tickData);

      const currentTick = tickData?.tickInfo?.tick;

      if (typeof currentTick !== 'number' || !Number.isInteger(currentTick) || currentTick < 0) {
        console.error('[getTick] Invalid or missing tick value in response:', tickData);
        throw new Error('Invalid tick data received from API.');
      }
      
      console.log(`[getTick] Returning valid tick: ${currentTick}`);
      return currentTick;

    } catch (error) {
      // Log the specific error, but re-throw a user-friendly one
      console.error('[getTick] Error processing tick fetch:', error);
      // Check if it's the error we threw above, otherwise create a generic one
      if (error.message.startsWith('Failed to fetch tick info') || error.message.startsWith('Invalid tick data')) {
          throw error; 
      } else {
          throw new Error('Could not retrieve current network tick. Check RPC endpoint and network connection.');
      }
    }
  };

  const connect = async (walletInfo, isRestoring = false) => {
    if (walletInfo.connectType === 'privateKey' && walletInfo.privateKey && !walletInfo.publicKey) {
       try {
         const idPackage = await qHelper.createIdPackage(walletInfo.privateKey);
         walletInfo.publicKey = await qHelper.getIdentity(idPackage.publicKey);
       } catch(e) {
         console.error("Failed to derive public key from private key:", e);
         return;
       }
    }
    if (!isRestoring) {
        localStorage.setItem("wallet", JSON.stringify(walletInfo));
        if (walletInfo.connectType === 'walletconnect' && walletInfo.wcSession) {
             localStorage.setItem("sessionTopic", walletInfo.wcSession.topic);
        }
    }
    setWallet(walletInfo);
    setConnected(true);
    setShowConnectModal(false);
    if (walletInfo.connectType === 'walletconnect' && walletInfo.wcSession) {
        setWcSession(walletInfo.wcSession);
    }
    setWcUri('');
    setWcQrCode('');
  };

  const disconnect = () => {
    const connectType = wallet?.connectType;
    localStorage.removeItem("wallet");
    localStorage.removeItem("sessionTopic");
    setWallet(null);
    setConnected(false);
    setWcUri('');
    setWcQrCode('');
    setWcIsConnecting(false);
    if (connectType === 'walletconnect' && wcSession && wcClient) {
      console.log("Disconnecting WC session topic:", wcSession.topic)
      wcClient.disconnect({ topic: wcSession.topic, reason: { code: 6000, message: "User disconnected" } })
        .catch(e => console.error("Error during WC disconnect request:", e));
    }
    setWcSession(null);
  };

  const updateHttpEndpoint = (newEndpoint) => {
    if (!newEndpoint) return;
    
    let cleanEndpoint = newEndpoint.trim();
    if (cleanEndpoint.endsWith('/')) {
      cleanEndpoint = cleanEndpoint.slice(0, -1);
    }
    
    if (!cleanEndpoint.startsWith('http://') && !cleanEndpoint.startsWith('https://')) {
      cleanEndpoint = 'https://' + cleanEndpoint;
    }
    
    setHttpEndpoint(cleanEndpoint);
    localStorage.setItem("httpEndpoint", cleanEndpoint);

    // Update contract indexes if we have a predefined configuration
    if (RPC_CONFIGS[cleanEndpoint]) {
      const newIndexes = RPC_CONFIGS[cleanEndpoint].indexes;
      setContractIndexes(newIndexes);
      localStorage.setItem('contractIndexes', JSON.stringify(newIndexes));
    }
    
    return cleanEndpoint;
  };

  const toggleConnectModal = () => {
    console.log("[Context] toggleConnectModal called. Current state:", showConnectModal);
    setShowConnectModal(prev => {
      console.log("[Context] Updating showConnectModal state to:", !prev);
      return !prev;
    });
  };

  const getSnap = async (version) => {
      if (!window.ethereum || !window.ethereum.isMetaMask) {
          throw new Error("MetaMask is not installed.");
      }
      try {
          const snaps = await window.ethereum.request({ method: 'wallet_getSnaps' });
          return Object.values(snaps).find(
              (snap) => snap.id === SNAP_ORIGIN && (!version || snap.version === version)
          );
      } catch (e) {
          console.error('Failed to get snaps', e);
          throw e;
      }
  };

  const connectSnap = async () => {
      if (!window.ethereum || !window.ethereum.isMetaMask) {
          throw new Error("MetaMask is not installed.");
      }
      setMmIsConnecting(true);
      setMmError(null);
      try {
          await window.ethereum.request({
              method: 'wallet_requestSnaps',
              params: {
                  [SNAP_ORIGIN]: SNAP_VERSION ? { version: SNAP_VERSION } : {},
              },
          });
          const installed = await getSnap();
          setMmInstalledSnap(installed);
          return installed;
      } catch (e) {
          console.error('Failed to connect Snap', e);
          setMmError(e.message || 'Failed to install or connect Snap.');
          throw e;
      } finally {
          setMmIsConnecting(false);
      }
  };

  const invokeSnap = async (method, params) => {
      if (!mmInstalledSnap) {
          throw new Error("Qubic Snap is not installed or connected.");
      }
      try {
          return await window.ethereum.request({
              method: 'wallet_invokeSnap',
              params: {
                  snapId: mmInstalledSnap.id,
                  request: { method, params },
              },
          });
      } catch (e) {
          console.error(`Snap invocation failed for method ${method}:`, e);
          setMmError(e.message || `Snap invocation failed: ${method}`);
          throw e;
      }
  };

  const startWalletConnect = async () => {
      if (!wcClient) throw new Error("WalletConnect client not initialized");
      setWcIsConnecting(true);
      setWcUri('');
      setWcQrCode('');
      console.log("Attempting wcClient.connect...");
      try {
          const { uri, approval } = await wcClient.connect({
              requiredNamespaces: {
                  qubic: {
                      chains: [WC_CHAIN_ID],
                      methods: [
                         'qubic_signTransaction',
                      ],
                      events: ['accountsChanged'],
                  },
              },
          });

          console.log("WC Connect URI generated:", uri);
          if (uri) {
              setWcUri(uri);
              try {
                  const qrData = await QRCode.toDataURL(uri);
                  setWcQrCode(qrData);
                  console.log("WC QR Code generated.");
              } catch (qrErr) {
                  console.error("Failed to generate WC QR code:", qrErr);
              }
          } else {
              console.warn("WalletConnect did not provide a URI.");
          }

          return { 
              approve: async () => {
                  console.log("Waiting for WC session approval...");
                  try {
                      const session = await approval();
                      console.log("WC Session approved:", session);
                      connect({ 
                          connectType: "walletconnect",
                          publicKey: session.namespaces.qubic.accounts[0].split(':')[2],
                          wcSession: session,
                      });
                  } catch (e) {
                       console.error("WC Connection approval rejected or failed:", e);
                      setWcUri('');
                      setWcQrCode('');
                      throw e;
                  }
              }
          };

      } catch (e) {
          console.error("WalletConnect connection failed:", e);
           setWcIsConnecting(false);
           setWcUri('');
           setWcQrCode('');
          throw e;
      } finally {
      }
  };

  const requestConfirmation = (txDetails, { onConfirm, onCancel }) => {
    setConfirmTxDetails(txDetails);
    setConfirmTxCallbacks({ onConfirm, onCancel });
    setShowConfirmModal(true);
  };

  const handleConfirm = async () => {
    if (confirmTxCallbacks.onConfirm) {
      await confirmTxCallbacks.onConfirm();
    }
    resetConfirmModalState();
  };

  const handleCancel = () => {
    if (confirmTxCallbacks.onCancel) {
      confirmTxCallbacks.onCancel();
    }
    resetConfirmModalState();
  };

   const resetConfirmModalState = () => {
    setShowConfirmModal(false);
    setConfirmTxDetails(null);
    setConfirmTxCallbacks({});
   };

  const signTransaction = async (tx) => {
    if (!wallet || !wallet.connectType) {
      throw new Error("Wallet not connected.");
    }

    if (!(tx instanceof Uint8Array)) {
        console.error("signTransaction received invalid tx format:", tx);
        throw new Error("Invalid transaction format provided for signing.");
    }

    const processedTx = tx;

    switch (wallet.connectType) {
      case "privateKey":
      case "vaultFile":
        if (!wallet.privateKey) throw new Error("Private key not available for signing.");
        return await localSignTx(qHelper, wallet.privateKey, processedTx);

      case "mmSnap":
        if (!mmInstalledSnap) throw new Error("MetaMask Snap not connected.");
        try {
            const base64Tx = uint8ArrayToBase64(processedTx);
            const offset = processedTx.length - SIGNATURE_LENGTH;

            console.log(`Requesting Snap signature for tx (Base64, offset ${offset}):`, base64Tx.substring(0, 100) + "...");

            const signedResult = await invokeSnap('signTransaction', {
                base64Tx,
                accountIdx: 0,
                offset,
            });

            console.log("Received result from Snap:", signedResult);

            if (!signedResult || typeof signedResult.signedTx !== 'string') {
                throw new Error("Snap did not return a valid signedTx string.");
            }
            const signatureBinary = atob(signedResult.signedTx);
            const signatureBytes = new Uint8Array(signatureBinary.length);
            for (let i = 0; i < signatureBinary.length; i++) {
                signatureBytes[i] = signatureBinary.charCodeAt(i);
            }
            
            if (signatureBytes.length !== SIGNATURE_LENGTH) {
                 throw new Error(`Snap returned signature of incorrect length: ${signatureBytes.length}`);
            }

            processedTx.set(signatureBytes, offset);
            return processedTx;
        } catch (error) {
            console.error("MetaMask Snap signing failed:", error);
            const snapErrorMessage = error?.data?.message || error?.message || error?.toString();
            const specificError = error?.code ? `{code: ${error.code}, message: \'${snapErrorMessage}\'}` : snapErrorMessage;
            throw new Error(`MetaMask Snap signing failed: ${specificError}`);
        }

      case "walletconnect":
        if (!wcSession || !wcClient) throw new Error("WalletConnect session not active.");
        try {
            console.log("Decoding TX for WalletConnect structured signing...");
            const decodedTx = decodeUint8ArrayTx(processedTx); 

            const fromAddress = wallet.publicKey;
            const toAddress = qHelper ? await qHelper.getIdentity(decodedTx.destinationPublicKey.getIdentity()) : "ID_CONVERSION_FAILED";
            const amount = decodedTx.amount.getNumber();
            const tick = decodedTx.tick;
            const inputType = decodedTx.inputType;
            const payloadBytes = decodedTx.payload ? decodedTx.payload.getPackageData() : null;
            const payloadBase64 = payloadBytes ? uint8ArrayToBase64(payloadBytes) : null;
            
            const signingParams = {
                 from: fromAddress,
                 to: toAddress,
                 amount: Number(amount),
                 tick: tick,
                 inputType: inputType,
                 payload: payloadBase64 === "" ? null : payloadBase64,
                 nonce: Date.now().toString(),
            };

            console.log("Requesting WC signature with params object:", signingParams);

            const wcResult = await wcClient.request({
                topic: wcSession.topic,
                chainId: WC_CHAIN_ID,
                request: {
                    method: 'qubic_signTransaction',
                    params: signingParams
                },
            });

            console.log("Received result from WC signing:", wcResult);

            if (typeof wcResult !== 'string' && typeof wcResult?.signedTransaction !== 'string') {
                console.error("Unexpected response format from WC signing:", wcResult);
                throw new Error("WalletConnect did not return a valid signedTransaction string.");
            }
            const signedTxBase64 = typeof wcResult === 'string' ? wcResult : wcResult.signedTransaction;
            const signedTxBytes = base64ToUint8Array(signedTxBase64);
            
            console.log(`Signed Tx Bytes Length: ${signedTxBytes.length} (Original: ${processedTx.length})`);
            if (signedTxBytes.length === SIGNATURE_LENGTH) { 
                 console.warn("WalletConnect returned only signature, inserting...");
                 processedTx.set(signedTxBytes, processedTx.length - SIGNATURE_LENGTH);
                 return processedTx;
            } else if (signedTxBytes.length !== processedTx.length) {
                 console.warn(`WC signed transaction length mismatch. Expected: ${processedTx.length}, Received: ${signedTxBytes.length}. Returning received bytes.`);
                 return signedTxBytes; 
            } else {
                 return signedTxBytes;
            }

        } catch (error) {
            console.error("WalletConnect signing failed:", error);
             const wcErrorMessage = error?.message || error?.toString();
             const specificError = error?.code ? `{code: ${error.code}, message: \'${wcErrorMessage}\'}` : wcErrorMessage;
            throw new Error(`WalletConnect signing failed: ${specificError}`);
        }
        break;

      default:
        throw new Error(`Unsupported wallet type for signing: ${wallet.connectType}`);
    }
  };

  const updateContractIndexes = (newIndexes) => {
    setContractIndexes(newIndexes);
    return newIndexes;
  };

  return (
    <QubicConnectContext.Provider
      value={{
        connected,
        wallet,
        showConnectModal,
        connect,
        disconnect,
        toggleConnectModal,
        signTransaction,
        getTick,
        broadcastTx,
        qHelper,
        httpEndpoint,
        updateHttpEndpoint,
        vault,
        wcClient,
        wcSession,
        wcUri,
        wcQrCode,
        wcIsConnecting,
        startWalletConnect,
        mmInstalledSnap,
        mmIsConnecting,
        mmError,
        connectSnap,
        getSnap,
        invokeSnap,
        showConfirmModal,
        confirmTxDetails,
        requestConfirmation,
        handleConfirm,
        handleCancel,
        balance,
        isBalanceLoading,
        balanceError,
        ownedAssets,
        isAssetsLoading,
        assetsError,
        possessedAssets,
        isPossessedAssetsLoading,
        possessedAssetsError,
        signTxWithFaucetKey,
        contractIndexes,
        updateContractIndexes,
      }}
    >
      {children}
    </QubicConnectContext.Provider>
  );
}

export function useQubicConnect() {
  const ctx = useContext(QubicConnectContext);
  if (!ctx) {
    throw new Error("useQubicConnect must be used within QubicConnectProvider");
  }
  return ctx;
}