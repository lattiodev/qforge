// src/App.js
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import DynamicForm from './components/DynamicForm';
import { QubicConnectProvider, useQubicConnect } from './context/QubicConnectContext';
import { queryContract, discoverContractFees, mightRequireFee } from './utils/contractApi';
import { executeTransactionWithWallet, sendQubicTransaction } from './utils/transactionApi';
import { parseContract, byteArrayToHexString } from './utils/contractUtils';
import ConnectLink from './components/qubic/connect/ConnectLink';
import ConfirmTxModal from './components/qubic/connect/ConfirmTxModal';
import FaucetModal from './components/qubic/FaucetModal';
import { 
    InformationCircleIcon, PlusIcon, MagnifyingGlassIcon, CheckCircleIcon, 
    CurrencyDollarIcon, CodeBracketIcon, BeakerIcon, Cog6ToothIcon,
    WalletIcon, PaperAirplaneIcon, ExclamationTriangleIcon, LinkIcon, ChevronUpIcon
} from '@heroicons/react/24/outline';
import './App.css';
import EndpointSetting from './components/EndpointSetting';
import ContractIndexManager from './components/ContractIndexManager';

// Define view constants - Remove Wallet Management
const VIEWS = {
    CONTRACT_EXPLORER: 'contract_explorer',
    // WALLET_MANAGEMENT: 'wallet_management',
};

// Component that uses the QubicConnect context
const ContractUI = () => {
  const [contracts, setContracts] = useState([]);
  const [selectedContract, setSelectedContract] = useState(null);
  const [selectedFunction, setSelectedFunction] = useState(null);
  const [apiResponse, setApiResponse] = useState(null);
  const [contractFees, setContractFees] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [txAmount, setTxAmount] = useState('0'); 
  const [formValues, setFormValues] = useState({}); 
  const [showFaucetModal, setShowFaucetModal] = useState(false);
  const [showTypeInfo, setShowTypeInfo] = useState(false);

  // State for toggles - Default to false (collapsed)
  const [showWalletInfo, setShowWalletInfo] = useState(true); 
  const [showSendQubic, setShowSendQubic] = useState(false);
  const [showRpcEndpoint, setShowRpcEndpoint] = useState(true);
  const [showFeeInfo, setShowFeeInfo] = useState(true);
  const [showContractIndexes, setShowContractIndexes] = useState(false);

  // State for the Send QUBIC form (moved from WalletManagementPage)
  const [destinationAddress, setDestinationAddress] = useState('');
  const [sendAmount, setSendAmount] = useState(''); // Amount in QUBIC (string)
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [sendResult, setSendResult] = useState(null);

  // Get the full context object first
  const fullQubicConnectContext = useQubicConnect();
    
  // Destructure for local use as needed
  const { 
      connected, 
      wallet, 
      httpEndpoint, 
      qHelper, 
      balance: contextBalance, 
      isBalanceLoading, 
      balanceError: contextBalanceError,
      ownedAssets,
      isAssetsLoading,
      assetsError,
      possessedAssets,
      isPossessedAssetsLoading,
      possessedAssetsError,
      requestConfirmation, 
      toggleConnectModal,
      broadcastTx, 
      getTick, 
      signTransaction,
      contractIndexes
  } = fullQubicConnectContext; 

  useEffect(() => {
    async function loadContractsList() {
      try {
        const res = await fetch('/contracts/contractsList.json');
        if (!res.ok) throw new Error(`Failed to fetch contract list: ${res.statusText}`);
        const list = await res.json();
        return list;
      } catch (error) {
        console.error("Error loading contract list:", error);
        setApiResponse({ success: false, error: `Failed to load contracts: ${error.message}` });
        return [];
      }
    }

    async function loadContracts() {
      setIsLoading(true);
      const list = await loadContractsList();
      if (!list || list.length === 0) {
        setIsLoading(false);
        return;
      }
      const contractsData = [];
      try {
        for (const fileName of list) {
          const res = await fetch(`/contracts/${fileName}`);
          if (!res.ok) {
            console.warn(`Failed to fetch contract ${fileName}: ${res.statusText}`);
            continue;
          }
          const content = await res.text();
          const parsed = parseContract(content);
          contractsData.push({
            fileName,
            content,
            contractName: parsed.contractName,
            functions: parsed.functions
          });
        }
        setContracts(contractsData);
      } catch (error) {
        console.error("Error loading contract content:", error);
        setApiResponse({ success: false, error: `Failed to load contract content: ${error.message}` });
      } finally {
        setIsLoading(false);
      }
    }
    loadContracts();
  }, []);

  const fetchContractFees = useCallback(async () => {
    if (!selectedContract || !httpEndpoint) return;
    setIsLoading(true);
    try {
      const feeInfo = await discoverContractFees(httpEndpoint, selectedContract);
      if (feeInfo) {
        setContractFees(prev => ({
          ...prev,
          [selectedContract.fileName]: feeInfo
        }));
      }
    } catch (error) {
      console.error(`Error fetching fees for ${selectedContract.fileName}:`, error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedContract, httpEndpoint]);

  useEffect(() => {
    fetchContractFees();
  }, [fetchContractFees]);

  useEffect(() => {
      setTxAmount('0');
      setFormValues({});
  }, [selectedFunction]);

  const handleFormValuesChange = useCallback((newValues) => {
      setFormValues(newValues);
  }, []);

  const handleExecute = () => {
    if (!selectedFunction) return; 

    let finalTxAmount = txAmount;

    if (selectedFunction.type === 'transaction') {
        const primaryAmountField = selectedFunction.inputs.find(f => f.name.toLowerCase() === 'amount');
        
        if (primaryAmountField) {
             finalTxAmount = formValues.amount || '0'; 
             console.log(`Using form amount ('${finalTxAmount}') for transaction value due to primary amount field.`);
        }
        executeFunction(formValues, finalTxAmount);
    } else {
        executeFunction(formValues, null); 
    }
  };

  async function executeFunction(currentFormValues, transactionAmountToSend) {
    if (!selectedContract || !selectedFunction) return;

    setApiResponse(null); 
    setIsLoading(true);

    try {
      const contractName = selectedContract.contractName || selectedContract.fileName.split('.')[0];
      console.log(`Executing ${selectedFunction.type}: ${selectedFunction.name}`);
      console.log("Form values:", currentFormValues);
      console.log("Amount to send with TX:", transactionAmountToSend);

      if (selectedFunction.type === 'view') {
        await executeViewFunction(contractName, currentFormValues);
      } else if (selectedFunction.type === 'transaction') {
        await executeTransactionFunction(contractName, currentFormValues, transactionAmountToSend);
      } else {
          throw new Error(`Unsupported function type: ${selectedFunction.type}`);
      }
    } catch (error) { 
      console.error("Function execution failed:", error);
      setApiResponse({ success: false, error: error.message || "An unknown error occurred." });
    } finally {
      setIsLoading(false);
    }
  }

  async function executeViewFunction(contractName, values) {
    const result = await queryContract(
      httpEndpoint,
      contractName,
      selectedFunction.index,
      values,
      selectedFunction.inputs,
      selectedFunction,
      contractIndexes
    );
    setApiResponse(result);
    console.log("View function result:", result);
  }

  async function executeTransactionFunction(contractName, paramsData, amountFromSeparateInput) { 
    if (!connected || !wallet?.publicKey) {
      setApiResponse({ success: false, error: "Wallet not connected..." });
      return;
    }
    
    let finalAmountInQus;
    const amountFromParams = paramsData?.amount; 

    const amountSourceValue = (amountFromParams !== undefined) ? amountFromParams : amountFromSeparateInput;
    
    try {
      finalAmountInQus = BigInt(amountSourceValue || 0); 
      console.log(`Using DIRECT amount as qus: ${finalAmountInQus.toString()} qus (Source value: ${amountSourceValue})`);
    } catch (e) {
      console.error("Invalid amount provided:", amountSourceValue);
      finalAmountInQus = 0n;
    }
    
    const txDetails = {
      qubicConnect: { 
        wallet, 
        qHelper, 
        getTick, 
        signTransaction, 
        broadcastTx, 
        connected,
        httpEndpoint
      },
      contractIndex: contractName,
      procedureIndex: selectedFunction.index,
      params: paramsData, 
      inputFields: selectedFunction.inputs, 
      amount: finalAmountInQus.toString(),
      sourceId: wallet.publicKey,
      destinationId: 'Contract: ' + contractName,
      functionName: selectedFunction.name, 
      functionParams: paramsData,
      contractIndexes
    };

    try {
      const result = await new Promise((resolve, reject) => {
        requestConfirmation(txDetails, {
          onConfirm: async () => {
            console.log("User confirmed, executing with:", txDetails);
            try {
              const txResult = await executeTransactionWithWallet(txDetails); 
              resolve(txResult);
            } catch (confirmError) {
              reject(confirmError);
            }
          },
          onCancel: () => {
            reject(new Error("Transaction cancelled by user."));
          }
        });
      });
      setApiResponse(result);
    } catch (error) {
      console.error("Transaction failed:", error);
      setApiResponse({ success: false, error: error.message });
    }
  }

  const renderTypeGuidance = (type) => {
    if (type === 'ProposalDataT') {
      return (
        <div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
          <h4>ProposalDataT Structure Guide</h4>
          <p>This is a complex type. Use the following JSON structure:</p>
          <pre style={{ backgroundColor: '#f1f1f1', padding: '8px', borderRadius: '4px' }}>
{`{
  "type": 0,
  "transfer": {
    "destination": "ID of destination account",
    "amounts": [amount1, amount2, amount3, amount4]
  }
}`}
          </pre>
          <p>Amounts are in millionth (0 to 1000000, representing 0% to 100%)</p>
        </div>
      );
    }
    return null;
  };

  const renderFeeInfo = () => {
    if (!selectedContract || !contractFees[selectedContract.fileName]) return null;
    
    const feeData = contractFees[selectedContract.fileName];
    const { feeInfo = {}, procedureConstants = {} } = feeData;
    
    const constants = Object.entries(feeInfo).filter(([key, val]) => val.source === 'parsed_constant');
    const feeFunctions = Object.entries(feeInfo).filter(([key, val]) => val.source === 'api');
    const procRequirements = Object.entries(procedureConstants);

    if (constants.length === 0 && feeFunctions.length === 0 && procRequirements.length === 0) {
        return null;
    }
    
    return (
      <div className="mt-4 p-3 border border-gray-700 rounded-lg bg-gray-700 bg-opacity-50 text-xs space-y-2 max-h-60 overflow-y-auto">
        <h4 className="text-sm font-semibold text-gray-300 mb-1 sticky top-0 bg-gray-700 bg-opacity-80 backdrop-blur-sm pb-1">Contract Info/Fees</h4>
        
        {constants.length > 0 && (
            <div>
                <p className="text-gray-400 font-medium">Constants:</p>
                <ul className="list-disc list-inside pl-2 text-gray-300 space-y-1">
                    {constants.map(([key, val]) => (
                        <li key={key}>{key}: {val?.data ? Object.values(val.data)[0] : 'N/A'}</li>
                    ))}
                </ul>
            </div>
        )}
        
        {feeFunctions.length > 0 && (
             <div className="pt-2 mt-2 border-t border-gray-600">
                <p className="text-gray-400 font-medium">Fee Functions:</p>
                 <ul className="list-disc list-inside pl-2 text-gray-300 space-y-1">
                     {feeFunctions.map(([key, val]) => (
                         <li key={key}>{key}: {val?.data ? JSON.stringify(val.data) : 'N/A'}</li>
                     ))}
                </ul>
            </div>
        )}

        {procRequirements.length > 0 && (
             <div className="pt-2 mt-2 border-t border-gray-600">
                <p className="text-gray-400 font-medium">Procedure Requirements:</p>
                 <ul className="list-disc list-inside pl-2 text-gray-300 space-y-1">
                     {procRequirements.map(([procName, reqs]) => (
                         <li key={procName}>{procName}: {JSON.stringify(reqs)}</li>
                     ))}
                </ul>
            </div>
        )}
      </div>
    );
  };

  const renderApiResponse = () => {
    if (!apiResponse) return null;

    const formatValue = (value) => {
      if (value === undefined || value === null) return <span className="text-gray-500 italic">null</span>;
      if (typeof value === 'boolean') return value ? <span className="text-green-500">true</span> : <span className="text-red-500">false</span>;
      if (Array.isArray(value)) return <pre className="text-xs bg-gray-700 p-1 rounded inline-block">{JSON.stringify(value)}</pre>;
      if (typeof value === 'object') return <pre className="text-xs bg-gray-700 p-1 rounded inline-block">{JSON.stringify(value, null, 2)}</pre>;
      if (typeof value === 'string' && /^\d+$/.test(value) && value.length > 3) {
        try {
          return BigInt(value).toLocaleString();
        } catch { 
          return value;
        }
      }
      if (typeof value === 'string' && value.length > 50) {
        return <span title={value}>{value.substring(0, 25)}...{value.substring(value.length - 25)}</span>;
      }
      return String(value);
    };

    return (
      <div className="mt-6 p-4 border border-gray-700 rounded-lg bg-gray-800 shadow">
        <h3 className="text-lg font-semibold mb-3 text-gray-200">API Response</h3>

        {apiResponse.success ? (
          <div className="space-y-3">
            <div className="p-2 bg-green-800 bg-opacity-50 text-green-300 border border-green-700 rounded text-sm">
              ✅ Request Successful
            </div>

            {apiResponse.message && (
              <p className="text-sm text-gray-300">{apiResponse.message}</p>
            )}

            {apiResponse.txHash && (
              <div className="text-sm">
                <strong className="text-gray-400">Transaction Hash:</strong>
                <span className="font-mono ml-2 break-all text-gray-300">{apiResponse.txHash}</span>
              </div>
            )}

            {apiResponse.explorerLink && (
              <div className="text-sm">
                <strong className="text-gray-400">Track Transaction:</strong>
                <a href={apiResponse.explorerLink} target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-400 hover:text-blue-300 underline">View on Explorer</a>
              </div>
            )}

            {apiResponse.decodedFields && Object.keys(apiResponse.decodedFields).length > 0 && (
              <div>
                <h4 className="text-md font-semibold mb-2 text-gray-300">Decoded Fields:</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse border border-gray-700">
                    <thead className="bg-gray-700">
                      <tr>
                        <th className="p-2 text-left font-medium text-gray-400 border border-gray-600">Field</th>
                        <th className="p-2 text-left font-medium text-gray-400 border border-gray-600">Value</th>
                      </tr>
                    </thead>
                    <tbody className="bg-gray-800">
                      {Object.entries(apiResponse.decodedFields).map(([field, value], idx) => (
                        <tr key={idx} className={`${idx % 2 === 0 ? 'bg-gray-800' : 'bg-gray-750'} hover:bg-gray-700`}>
                          <td className="p-2 border border-gray-600 text-gray-300 font-medium">{field}</td>
                          <td className="p-2 border border-gray-600 text-gray-200 font-mono break-all">{formatValue(value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {apiResponse.rawHex && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-gray-400 hover:text-gray-200">Raw Binary Data ({apiResponse.byteLength} bytes)</summary>
                <div className="mt-2 p-2 bg-gray-900 border border-gray-700 rounded overflow-x-auto text-xs font-mono text-gray-400">
                  {apiResponse.rawHex}
                </div>
              </details>
            )}
          </div>
        ) : (
          <div className="p-2 bg-red-800 bg-opacity-50 text-red-300 border border-red-700 rounded text-sm">
            ❌ Error: {apiResponse.error}
          </div>
        )}
      </div>
    );
  };

  let showForm = false;
  let showTxAmountInput = false;
  let showExecuteButton = false;

  if (selectedFunction) {
      const specificAmountFieldNames = ['amount'];
      const hasSpecificAmountField = selectedFunction.inputs.some(f => specificAmountFieldNames.includes(f.name.toLowerCase()));
      const isSendToManyV1 = selectedFunction.name === 'SendToManyV1';

      showForm = selectedFunction.inputs.length > 0;

      if (selectedFunction.type === 'transaction') {
          showTxAmountInput = !hasSpecificAmountField || isSendToManyV1; 
          showExecuteButton = true;
      } else { 
          showTxAmountInput = false;
          showExecuteButton = !showForm;
      }
  }

  const renderFunctionGuidance = () => {
    if (!selectedFunction) return null;

    let guidance = null;
    switch (selectedFunction.name) {
        case 'BurnQubic':
            guidance = "Note: The amount entered below will be used for both the input data and the transaction value.";
            break;
        case 'SendToManyV1':
            guidance = "Note: Ensure the \"Transaction Amount\" below manually matches the total of all \"amtX\" fields + 10 qus fee.";
            break;
        case 'lock':
            guidance = "Note: The \"Transaction Amount\" below specifies the Qubic amount to lock.";
            break;
    }

    if (!guidance) return null;

    return (
        <div className="mt-4 mb-4 p-3 border border-blue-800 bg-blue-900 bg-opacity-40 rounded-lg text-xs text-blue-200 flex items-start">
            <InformationCircleIcon className="h-4 w-4 mr-2 flex-shrink-0 text-blue-400" />
            <span>{guidance}</span>
        </div>
    );
  };

  const handleAddContractClick = () => {
      alert("Feature under development: Adding contracts via UI is not yet implemented.");
  };

  // Function to render the supported types disclaimer
  const renderSupportedTypesInfo = () => (
      <div className="mt-2 p-3 border border-gray-600 bg-gray-700 bg-opacity-40 rounded-lg text-xs text-gray-300 space-y-1">
         <h5 className="font-semibold text-gray-200 mb-1">Supported Input Types:</h5>
         <ul className="list-disc list-inside pl-2 text-gray-400 text-[0.7rem] leading-snug">
            <li>Basic types: `uint8`-`uint64`, `sint8`-`sint64`, `bit`, `bool`</li>
            <li>Identity: `id` (60-char string)</li>
            <li>Fixed string: `char[size]`</li>
            <li>Arrays: `Array&lt;type, size&gt;` (Input as JSON string, e.g., `["value1", "value2"]` or `[1, 2, 3]`)</li>
            <li>Complex: `ProposalDataT` (Input as JSON string)</li>
         </ul>
         <p className="text-[0.7rem] text-gray-500 mt-1">Note: Size for Arrays can be a number or known contract constant (e.g., `MSVAULT_MAX_OWNERS`). Nested complex types within arrays may have limitations.</p>
         <p className="text-[0.7rem] text-blue-300 mt-2 pt-1 border-t border-gray-600">
            Need support for another type? Please mention us on the Qubic Discord in the #dev channel!
         </p>
      </div>
  );

  // Format the balance from the context (assuming NO conversion - as per previous step)
  const formattedBalance = useMemo(() => {
      if (contextBalance !== null && contextBalance !== undefined) {
          try {
              return BigInt(contextBalance).toString(); 
          } catch (e) {
               console.error("Error formatting balance:", e);
               return 'Error'; 
          }
      }
      return null;
  }, [contextBalance]);

  // --- Send QUBIC Logic (moved from WalletManagementPage) --- 
  const handleSendQubic = async (e) => {
      e.preventDefault();
      if (!connected || !wallet) {
          setSendError("Wallet not connected.");
          return;
      }
      if (!destinationAddress || !sendAmount) {
          setSendError("Please fill in both destination address and amount.");
          return;
      }

      setIsSending(true);
      setSendError(null);
      setSendResult(null);

      try {
          let amountRawUnits;
          try {
               amountRawUnits = BigInt(sendAmount.trim());
          } catch (e) {
               throw new Error("Invalid amount. Please enter a whole number.");
          }

          if (amountRawUnits <= 0n) {
               throw new Error("Amount must be positive.");
          }
           if (contextBalance && amountRawUnits > BigInt(contextBalance)) {
               console.log(`[App.js/ContractUI] Balance Check - Amount: ${amountRawUnits}, Context Balance: ${contextBalance}`);
               throw new Error("Insufficient balance.");
           }

          console.log(`Sending ${amountRawUnits} (raw units) to ${destinationAddress}`);

          // Call the transaction API function
          const result = await sendQubicTransaction({
              qubicConnect: fullQubicConnectContext, // Pass the full context object
              destinationPublicKey: destinationAddress.trim(),
              amountQus: amountRawUnits.toString(), 
          });

          console.log("Send Qubic Result:", result);
          setSendResult(result);
          setDestinationAddress(''); 
          setSendAmount('');

      } catch (error) {
          console.error("Error sending QUBIC:", error);
          setSendError(error.message || 'An unexpected error occurred during sending.');
      } finally {
          setIsSending(false);
      }
  };
  // --- End Send QUBIC Logic ---

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 p-4 md:p-6 font-sans">
      <div className="flex justify-between items-center mb-6 gap-4 border-b border-gray-700 pb-4">
        <h1 className="text-2xl font-bold text-white flex-shrink-0">QForge</h1>
        <div className="flex items-center gap-2 sm:gap-3">
           {/* Remove the view toggle button */}
           {/* <button ... /> */}
          <button
            onClick={() => setShowFaucetModal(true)}
            disabled={!connected}
            className={`px-3 py-2 rounded font-semibold text-sm transition duration-150 ease-in-out flex items-center whitespace-nowrap ${!connected ? 'bg-gray-600 opacity-50 cursor-not-allowed text-gray-400' : 'bg-teal-600 hover:bg-teal-700 text-white'}`}
            title={connected ? "Open Faucet" : "Connect wallet to use faucet"}
          >
             <CurrencyDollarIcon className="h-5 w-5 mr-1.5"/> Faucet
          </button>
          <ConnectLink />
        </div>
      </div>

      {/* Main layout: Sidebar + Content Area */}
      <div className="flex flex-col md:flex-row gap-4">
            {/* --- Left Sidebar (Existing Widgets) --- */}
            <div className="md:w-1/4 flex flex-col gap-4">
              {/* RPC Endpoint */}
              <div className="bg-gray-800 p-4 rounded-lg shadow">
                <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-2">
                  <h2 className="text-lg font-semibold text-white flex items-center">
                    <Cog6ToothIcon className="h-5 w-5 mr-2"/> RPC Endpoint
                  </h2>
                  <button onClick={() => setShowRpcEndpoint(!showRpcEndpoint)} className="text-gray-400 hover:text-white">
                    <ChevronUpIcon className={`h-5 w-5 transition-transform ${!showRpcEndpoint ? 'rotate-180' : ''}`} />
                  </button>
                </div>
                {showRpcEndpoint && (
                  <EndpointSetting />
                )}
              </div>

              {/* Wallet Info */}
              <div className="bg-gray-800 p-4 rounded-lg shadow">
                <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-2">
                  <h2 className="text-lg font-semibold text-white flex items-center">
                    <WalletIcon className="h-5 w-5 mr-2"/> Wallet Info
                  </h2>
                  <button onClick={() => setShowWalletInfo(!showWalletInfo)} className="text-gray-400 hover:text-white">
                    <ChevronUpIcon className={`h-5 w-5 transition-transform ${!showWalletInfo ? 'rotate-180' : ''}`} />
                  </button>
                </div>
                {showWalletInfo && (
                  <>
                      {!connected ? (
                          <div className="flex items-center p-3 bg-yellow-900 bg-opacity-40 border border-yellow-700 rounded-lg text-yellow-200 text-sm">
                             <InformationCircleIcon className="h-5 w-5 mr-2 flex-shrink-0"/> Please connect your wallet.
                          </div>
                      ) : (
                          <div className="space-y-3 text-sm max-h-60 overflow-y-auto pr-1">
                             <div>
                                 <span className="font-medium text-gray-400">Status:</span>
                                 <span className="ml-2 text-green-400">Connected</span>
                             </div>
                              <div>
                                 <span className="font-medium text-gray-400">Public Key:</span>
                                 <span className="ml-2 font-mono break-all">{wallet.publicKey}</span>
                             </div>
                              <div>
                                 <span className="font-medium text-gray-400">Balance:</span>
                                 {isBalanceLoading ? (
                                     <span className="ml-2 text-gray-400 italic">Loading...</span>
                                 ) : contextBalanceError ? (
                                     <span className="ml-2 text-red-400">{contextBalanceError}</span>
                                 ) : formattedBalance !== null ? (
                                      <span className="ml-2 font-semibold text-lg">{formattedBalance} <span className="text-xs">QUBIC</span></span>
                                 ) : (
                                     <span className="ml-2 text-gray-500 italic">N/A</span>
                                 )}
                             </div>
                              {/* Owned Assets */}
                              <div>
                                 <span className="font-medium text-gray-400">Owned Assets:</span>
                                 {isAssetsLoading ? (
                                     <span className="ml-2 text-gray-400 italic">Loading...</span>
                                 ) : assetsError ? (
                                     <span className="ml-2 text-red-400">{assetsError}</span>
                                 ) : ownedAssets && ownedAssets.length > 0 ? (
                                     <ul className="ml-2 list-none space-y-1 mt-1">
                                         {ownedAssets.map((asset, index) => (
                                             <li key={`owned-${index}`} className="font-mono text-xs bg-gray-700 px-2 py-1 rounded break-all">
                                                 {asset?.data?.numberOfUnits ? `${asset.data.numberOfUnits} x ` : ''}
                                                 {asset?.data?.issuedAsset?.name || 'Unknown Asset'}
                                             </li>
                                         ))}
                                     </ul>
                                 ) : (
                                     <span className="ml-2 text-gray-500 italic">No assets found.</span>
                                 )}
                             </div>
                             {/* Possessed Assets */}
                              <div>
                                 <span className="font-medium text-gray-400">Possessed Assets:</span>
                                 {isPossessedAssetsLoading ? (
                                     <span className="ml-2 text-gray-400 italic">Loading...</span>
                                 ) : possessedAssetsError ? (
                                     <span className="ml-2 text-red-400">{possessedAssetsError}</span>
                                 ) : possessedAssets && possessedAssets.length > 0 ? (
                                     <ul className="ml-2 list-none space-y-1 mt-1">
                                         {possessedAssets.map((asset, index) => (
                                             <li key={`possessed-${index}`} className="font-mono text-xs bg-gray-700 px-2 py-1 rounded break-all">
                                                 {asset?.data?.numberOfUnits ? `${asset.data.numberOfUnits} x ` : ''}
                                                 {asset?.data?.ownedAsset?.issuedAsset?.name || asset?.data?.issuedAsset?.name || 'Unknown Asset'}
                                             </li>
                                         ))}
                                     </ul>
                                 ) : (
                                     <span className="ml-2 text-gray-500 italic">No possessed assets found.</span>
                                 )}
                             </div>
                         </div>
                      )}
                  </>
                )}
              </div>

              {/* Contract Index Manager */}
              <div className="bg-gray-800 p-4 rounded-lg shadow">
                <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-2">
                  <h2 className="text-lg font-semibold text-white flex items-center">
                    <Cog6ToothIcon className="h-5 w-5 mr-2"/> Contract Indexes
                  </h2>
                  <button onClick={() => setShowContractIndexes(!showContractIndexes)} className="text-gray-400 hover:text-white">
                    <ChevronUpIcon className={`h-5 w-5 transition-transform ${!showContractIndexes ? 'rotate-180' : ''}`} />
                  </button>
                </div>
                {showContractIndexes && <ContractIndexManager />}
              </div>

              {/* Send QUBIC */}
              <div className="bg-gray-800 p-4 rounded-lg shadow">
                  <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-2">
                      <h2 className="text-lg font-semibold text-white flex items-center">
                           <PaperAirplaneIcon className="h-5 w-5 mr-2 transform rotate-45"/> Send QUBIC
                      </h2>
                       <button onClick={() => setShowSendQubic(!showSendQubic)} className="text-gray-400 hover:text-white">
                          <ChevronUpIcon className={`h-5 w-5 transition-transform ${!showSendQubic ? 'rotate-180' : ''}`} />
                       </button>
                   </div>
                   {showSendQubic && (
                       <>
                          {!connected ? (
                               <div className="flex items-center p-3 bg-yellow-900 bg-opacity-40 border border-yellow-700 rounded-lg text-yellow-200 text-sm">
                                  <InformationCircleIcon className="h-5 w-5 mr-2 flex-shrink-0"/> Connect wallet to send.
                               </div>
                           ) : (
                               <form onSubmit={handleSendQubic} className="space-y-4 text-sm">
                                  <div>
                                      <label htmlFor="appDestination" className="block text-gray-400 mb-1 font-medium">Destination Address</label>
                                      <input
                                          type="text"
                                          id="appDestination"
                                          value={destinationAddress}
                                          onChange={(e) => setDestinationAddress(e.target.value)}
                                          placeholder="Paste Qubic Public Key (60 chars)"
                                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500 font-mono text-xs"
                                          maxLength={60}
                                          required
                                      />
                                  </div>
                                   <div>
                                      <label htmlFor="appAmount" className="block text-gray-400 mb-1 font-medium">Amount (QUBIC)</label>
                                      <input
                                          type="number"
                                          id="appAmount"
                                          value={sendAmount}
                                          onChange={(e) => {
                                               const value = e.target.value;
                                               if (/^\d*$/.test(value)) {
                                                   setSendAmount(value);
                                               }
                                          }}
                                          placeholder="e.g., 50"
                                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500"
                                          step="1"
                                          required
                                      />
                                      <p className="text-xs text-gray-500 mt-1">
                                          Note: The Qubic network may enforce a minimum transaction amount (dust limit).
                                      </p>
                                  </div>
                                  <button
                                      type="submit"
                                      disabled={isSending || !destinationAddress || !sendAmount || isBalanceLoading}
                                      className="w-full flex justify-center items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
                                  >
                                      {isSending ? 'Sending...' : 'Send QUBIC'}
                                  </button>
                                   {/* Sending Status Messages */}
                                  {sendError && (
                                      <div className="flex items-center p-3 bg-red-900 bg-opacity-50 border border-red-700 rounded-lg text-red-300 text-xs mt-3">
                                          <ExclamationTriangleIcon className="h-4 w-4 mr-2 flex-shrink-0"/>
                                          <span><strong>Error:</strong> {sendError}</span>
                                      </div>
                                  )}
                                  {sendResult && sendResult.success && (
                                      <div className="flex items-start p-3 bg-green-900 bg-opacity-50 border border-green-700 rounded-lg text-green-300 text-xs mt-3 space-x-2">
                                          <CheckCircleIcon className="h-4 w-4 mt-0.5 flex-shrink-0"/>
                                          <div className="flex-grow">
                                              <span>{sendResult.message}</span>
                                              {sendResult.txHash && sendResult.txHash !== 'N/A' && (
                                                   <a
                                                      href={sendResult.explorerLink}
                                                      target="_blank"
                                                      rel="noopener noreferrer"
                                                      className="block mt-1 text-blue-400 hover:text-blue-300 underline truncate"
                                                  >
                                                     <LinkIcon className="h-3 w-3 inline-block mr-1" /> Tx: {sendResult.txHash}
                                                  </a>
                                              )}
                                          </div>
                                      </div>
                                  )}
                               </form>
                           )}
                       </>
                   )}
               </div>

              {/* Type Information */}
              <div className="bg-gray-800 p-4 rounded-lg shadow">
                <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-2">
                  <h2 className="text-lg font-semibold text-white flex items-center">
                    <InformationCircleIcon className="h-5 w-5 mr-2"/> Type Information
                  </h2>
                  <button onClick={() => setShowTypeInfo(!showTypeInfo)} className="text-gray-400 hover:text-white">
                    <ChevronUpIcon className={`h-5 w-5 transition-transform ${!showTypeInfo ? 'rotate-180' : ''}`} />
                  </button>
                </div>
                 {showTypeInfo && renderSupportedTypesInfo()}
              </div>

            </div> {/* End Left Sidebar */}

            {/* --- Main Content Area (New Layout) --- */}
            <div className="flex-grow flex flex-col gap-4">
              {/* Top: Contract Selection */}
              <div className="bg-gray-800 p-4 rounded-lg shadow">
                  <div className="flex justify-between items-center mb-3">
                      <h2 className="text-xl font-semibold text-white">Contract</h2>
                       <button 
                          onClick={handleAddContractClick} 
                          className="text-sm bg-gray-600 hover:bg-gray-500 text-gray-200 px-3 py-1.5 rounded flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Feature coming soon"
                          // disabled // Enable when feature is ready
                       >
                          <PlusIcon className="h-4 w-4 mr-1" /> Add Contract
                      </button>
                  </div>
                  <div className="mb-3">
                     {isLoading && contracts.length === 0 ? (
                       <p className="text-sm text-gray-400 italic">Loading contracts...</p>
                     ) : !isLoading && contracts.length === 0 ? (
                       <p className="text-sm text-red-400">No contracts found.</p>
                     ) : (
                        <select
                           id="contractSelect"
                           className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                           value={selectedContract ? selectedContract.fileName : ''}
                           onChange={(e) => {
                              const selectedFile = e.target.value;
                              const contract = contracts.find(c => c.fileName === selectedFile);
                              setSelectedContract(contract);
                              setSelectedFunction(null);
                              setApiResponse(null);
                           }}
                        >
                           <option value="" disabled>-- Select a Contract --</option>
                           {contracts.map((contract, index) => (
                             <option key={index} value={contract.fileName}>
                               {contract.fileName} ({contract.functions.length} functions)
                             </option>
                           ))}
                        </select>
                      )}
                   </div>
                   {selectedContract && (
                      <p className="text-sm text-gray-400 mt-1">
                          {/* Placeholder for description - you might need to parse this from comments or add it */}
                          {selectedContract.fileName.includes('Token') ? 'ERC-20 compatible token contract' : 'Interact with the selected contract.'}
                      </p>
                   )}
              </div> {/* End Contract Selection */}

              {/* New Section: Fee Information */}
              {selectedContract && (
                 <div className="bg-gray-800 p-4 rounded-lg shadow">
                     <div className="flex justify-between items-center mb-2 border-b border-gray-700 pb-1">
                        <h2 className="text-lg font-semibold text-white">Contract Fee Information</h2>
                         <button onClick={() => setShowFeeInfo(!showFeeInfo)} className="text-gray-400 hover:text-white">
                            <ChevronUpIcon className={`h-5 w-5 transition-transform ${!showFeeInfo ? 'rotate-180' : ''}`} />
                        </button>
                     </div>
                    {showFeeInfo && renderFeeInfo()} 
                 </div>
              )}

              {/* Bottom: Function Interaction & Response */}
              <div className="flex flex-col md:flex-row gap-4 flex-grow">
                {/* Left Column: Function Interaction */}
                <div className="md:w-1/2 bg-gray-800 p-4 rounded-lg shadow flex flex-col">
                   <h2 className="text-lg font-semibold mb-3 text-white border-b border-gray-700 pb-2">Function Interaction</h2>
                    {!selectedContract ? (
                       <p className="text-sm text-gray-400 italic text-center mt-6 flex-grow flex items-center justify-center">Select a contract above.</p>
                    ) : (
                       <div className="space-y-4 overflow-y-auto pr-1 flex-grow">
                          <p className="text-sm text-gray-300">Select a function and provide the required parameters.</p>
                          {/* Function Dropdown */}
                          <div>
                             <label htmlFor="functionSelect" className="block text-sm font-medium text-gray-300 mb-1">Function</label>
                             <div className="flex items-center gap-2">
                                <select
                                    id="functionSelect"
                                    className="flex-grow p-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                    value={selectedFunction ? selectedFunction.name : ''}
                                    onChange={(e) => {
                                        const func = selectedContract.functions.find(f => f.name === e.target.value);
                                        setSelectedFunction(func);
                                        setApiResponse(null);
                                    }}
                                    disabled={!selectedContract}
                                >
                                    <option value="" disabled>-- Select a function --</option>
                                    {selectedContract.functions.map((fn, idx) => (
                                        <option key={idx} value={fn.name}>{fn.name} ({fn.type})</option>
                                    ))}
                                </select>
                             </div>
                             {selectedFunction && (
                                <p className="text-xs text-gray-400 mt-1">
                                   {/* Placeholder for function description - needs parsing */}
                                   {`Invoke the ${selectedFunction.name} function.`}
                                </p>
                              )}
                          </div>

                          {selectedFunction && (
                             <>
                                {renderFunctionGuidance()} 
                                {/* Parameters Section */}
                                {showForm && (
                                  <div>
                                      <label className="block text-sm font-medium text-gray-300 mb-2">Parameters</label>
                                      <DynamicForm 
                                        fields={selectedFunction.inputs} 
                                        onSubmit={handleExecute} // The form itself might not need the submit, button below handles it
                                        isTransaction={selectedFunction.type === 'transaction'}
                                        onValuesChange={handleFormValuesChange}
                                        hideSubmitButton={true}
                                      />
                                  </div>
                                )}

                                {/* Transaction Value Input (if applicable) */}
                                {showTxAmountInput && ( 
                                  <div className="pt-3">
                                      <label htmlFor="txValueInput" className="block text-sm font-medium text-gray-300 mb-1">
                                          Transaction Value (qus)
                                      </label>
                                      <input
                                          type="number"
                                          id="txValueInput"
                                          name="txValueInput"
                                          className={`w-full p-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent`}
                                          value={txAmount}
                                          onChange={(e) => setTxAmount(e.target.value.replace(/[^0-9]/g, ''))}
                                          min="0"
                                          placeholder="0"
                                      />
                                      <p className="text-xs text-gray-400 mt-1">
                                          {selectedFunction?.name === 'SendToManyV1' 
                                             ? "WARNING: For SendToManyV1, this MUST equal Sum(amtX) + fee (e.g., 10) in QUS, otherwise the transaction will likely fail."
                                             : "Amount in millionths (qus) to send with the transaction (e.g., for qearn.lock). Leave as 0 if not required."}
                                      </p>
                                  </div>
                                )}

                                {!showForm && selectedFunction.type === 'view' && (
                                    <div className="text-center p-3 bg-gray-700 rounded mt-4">
                                        <p className="text-sm text-gray-300 mb-0">No parameters required for this function.</p>
                                    </div>
                                )}

                                {/* Fee Info (Simplified) & Execute Button */}
                                <div className="mt-auto pt-4 border-t border-gray-700">
                                    <div className="flex justify-between items-center mb-3 text-sm">
                                        <span className="text-gray-400">Estimated fee:</span>
                                        <span className="text-gray-300">
                                            {(() => {
                                                if (!selectedFunction) return 'N/A';
                                                if (selectedFunction.type === 'view') return '0 Qubic';
                                                
                                                // For transactions, try to find the specific fee
                                                const feeData = contractFees[selectedContract?.fileName];
                                                const feeInQus = feeData?.procedureConstants?.[selectedFunction.name]?.['required amount'];
                                                
                                                if (feeInQus !== undefined && feeInQus !== null) {
                                                    try {
                                                        const feeBigInt = BigInt(feeInQus);
                                                        // Assuming fee is in Qus (millionths), convert to Qubic
                                                        const feeInQubic = Number(feeBigInt) / 1_000_000;
                                                        return `${feeInQubic.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 6 })} Qubic`;
                                                    } catch (e) {
                                                        console.error("Error parsing or formatting fee:", feeInQus, e);
                                                        return 'Error'; // Indicate a problem processing the fee
                                                    }
                                                } else {
                                                     // If no specific fee is defined for this transaction function, show 0
                                                    return '0 Qubic';
                                                }
                                            })()}
                                        </span>
                                    </div>
                                    <button 
                                       type="button" 
                                       onClick={handleExecute}
                                       disabled={isLoading || (selectedFunction.type === 'transaction' && !connected) || !selectedFunction}
                                       className={`w-full px-4 py-2 rounded font-semibold text-white transition duration-150 ease-in-out flex items-center justify-center ${selectedFunction.type === 'transaction' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-purple-600 hover:bg-purple-700'} disabled:bg-gray-600 disabled:opacity-70 disabled:cursor-not-allowed`}
                                    >
                                        {isLoading ? (
                                            // Simple loading text for now
                                            'Processing...'
                                        ) : selectedFunction.type === 'view' ? (
                                            <><BeakerIcon className="h-5 w-5 mr-1.5" /> View</> // Using Beaker for View
                                        ) : (
                                            <><PaperAirplaneIcon className="h-5 w-5 mr-1.5 transform rotate-45" /> Execute</> // Using PaperAirplane for Execute
                                        )}
                                    </button>
                                </div>
                             </>
                           )}
                       </div>
                    )}
                 </div> {/* End Function Interaction */}

                {/* Right Column: Response */}
                <div className="md:w-1/2 bg-gray-800 p-4 rounded-lg shadow flex flex-col">
                    <h2 className="text-lg font-semibold mb-3 text-white border-b border-gray-700 pb-2">Response</h2>
                    <p className="text-sm text-gray-300 mb-3">Function call results will appear here</p>
                    <div className="flex-grow overflow-y-auto pr-1">
                        {apiResponse ? (
                            renderApiResponse()
                        ) : (
                            <div className="h-full flex items-center justify-center border border-dashed border-gray-600 rounded-md p-6">
                               <p className="text-sm text-gray-500 italic">No recent function calls</p>
                            </div>
                        )}
                    </div>
                </div> {/* End Response */}
              </div> {/* End Bottom Section */}
            </div> {/* End Main Content Area */}
        </div> {/* End Main Layout */}

      <ConfirmTxModal />
      <FaucetModal open={showFaucetModal} onClose={() => setShowFaucetModal(false)} />
    </div>
  );
};

const App = () => {
  return (
    <QubicConnectProvider>
      <ContractUI />
    </QubicConnectProvider>
  );
};

export default App;