// src/components/DynamicForm.js
import React, { useState, useEffect } from 'react';

const DynamicForm = ({ fields, onSubmit, isTransaction = false, onValuesChange = () => {}, hideSubmitButton = false, responseData = null }) => {
  const formatResponseValue = (value, type) => {
    if (value === null || value === undefined) return '';
    
    if (type === 'OrderResponse') {
      return JSON.stringify(value, null, 2);
    }
    
    if (Array.isArray(value)) {
      return JSON.stringify(value);
    }
    
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }
    
    return String(value);
  };

  const initializeState = () => {
    const initial = {};
    fields.forEach(field => {
      if (field.type === 'ProposalDataT' || field.type === 'ProposalDataYesNo') {
        initial[field.name] = JSON.stringify({
          url: "https://qubic.org/proposal",
          epoch: 1,
          type: 256,
          transfer: {
            destination: '0000000000000000000000000000000000000000000000000000000000000000',
            amount: 0
          }
        }, null, 2);
      } else if (field.type === 'OrderResponse') {
        initial[field.name] = JSON.stringify({
          orderId: "0",
          originAccount: "0000000000000000000000000000000000000000000000000000000000000000",
          destinationAccount: "0000000000000000000000000000000000000000000000000000000000000000",
          amount: "0",
          memo: "",
          sourceChain: 0
        }, null, 2);
      } else if (field.type.includes('int') || field.type.includes('uint')) {
        initial[field.name] = '0';
      } else {
        initial[field.name] = '';
      }
    });
    return initial;
  };

  const [values, setValues] = useState(initializeState);
  const [jsonErrors, setJsonErrors] = useState({});

  useEffect(() => {
    const initial = initializeState();
    setValues(initial);
    onValuesChange(initial);
  }, [fields]);

  const handleChange = (e) => {
    const { name, value, type } = e.target;
    let processedValue = value;
    if (type === 'number') {
      processedValue = value.replace(/[^0-9]/g, '');
    }

    // Validate JSON for array fields and complex objects on change
    const field = fields.find(f => f.name === name);
    if (field && (field.type === 'Array' || field.type === 'OrderResponse' || field.type.includes('ProposalData'))) {
      try {
        JSON.parse(processedValue);
        setJsonErrors(prev => ({ ...prev, [name]: null })); // Clear error on valid JSON
      } catch (error) {
        // Only set error if the string isn't empty, allows user to clear the field
        setJsonErrors(prev => ({ ...prev, [name]: processedValue.trim() ? 'Invalid JSON format' : null }));
      }
    }

    setValues(prev => {
      const newState = { ...prev, [name]: processedValue };
      onValuesChange(newState);
      return newState;
    });
  };
  
  const renderInputGuidance = (field) => {
    let guidanceText = null;
    if (field.type === 'ProposalDataT' || field.type === 'ProposalDataYesNo') {
      guidanceText = 'Enter proposal data as JSON. See console/docs for structure.';
    } else if (field.type === 'OrderResponse') {
      guidanceText = 'Enter order response data as JSON with fields: orderId, originAccount, destinationAccount, amount, memo, sourceChain';
    } else if (field.type === 'id') {
      guidanceText = 'Enter a 60-character Qubic ID (e.g., EFG...).';
    } else if (field.type === 'Array') {
      guidanceText = `Enter a valid JSON array (e.g., ["abc", "def"] or [1, 2, 3]) containing elements of type '${field.elementType}'. Max items: ${field.size || 'N/A'}.`;
    } else if (field.type.includes('int') || field.type.includes('uint')) {
        guidanceText = 'Enter a whole number.';
    } else if (field.type.startsWith('char[')) {
         const sizeMatch = field.type.match(/\[(\d+)\]/);
         const charSize = sizeMatch ? parseInt(sizeMatch[1], 10) : 'N/A';
         guidanceText = `Enter text (UTF-8). Max length: ${charSize}.`;
    }

    return guidanceText ? (
      <p className="text-xs text-gray-400 mt-1">{guidanceText}</p>
    ) : null;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Check for JSON errors before submitting
    const hasErrors = Object.values(jsonErrors).some(error => error !== null);
    if (hasErrors) {
      alert('Please fix the JSON errors before submitting.');
      return;
    }

    const processedValues = {};
    fields.forEach(field => {
      const value = values[field.name];
      
      if (field.type === 'Array' || field.type === 'OrderResponse' || field.type.includes('ProposalData')) {
        try {
          processedValues[field.name] = JSON.parse(value);
        } catch (error) {
          console.error(`Error parsing JSON for ${field.name}:`, error);
          processedValues[field.name] = value; // Keep original on error
        }
      } else if (field.type.includes('int')) {
        processedValues[field.name] = value || '0';
      } else {
        processedValues[field.name] = value;
      }
    });
    
    onSubmit(processedValues);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {fields.map((field) => (
        <div key={field.name}>
          <label htmlFor={field.name} className="block text-sm font-medium text-gray-300 mb-1">
            {field.name} <span className="text-xs text-gray-500">({field.type === 'Array' ? `Array<${field.elementType}, ${field.size}>` : field.type})</span>
          </label>
          {(field.type.includes('ProposalData') || field.type === 'Array' || field.type === 'OrderResponse') ? (
            <textarea
              id={field.name}
              name={field.name}
              className={`w-full p-2 bg-gray-700 border ${jsonErrors[field.name] ? 'border-red-500' : 'border-gray-600'} rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 ${jsonErrors[field.name] ? 'focus:ring-red-500' : 'focus:ring-blue-500'} focus:border-transparent font-mono text-sm min-h-[80px]`}
              value={responseData ? formatResponseValue(responseData[field.name], field.type) : values[field.name]}
              onChange={handleChange}
              placeholder={field.type === 'Array' ? 'e.g., ["item1", "item2"] or [123, 456]' : 
                         field.type === 'OrderResponse' ? '{"orderId": "0", "originAccount": "...", ...}' : undefined}
              readOnly={!!responseData}
            />
          ) : (
            <input
              type={(field.type.includes('int') || field.type.includes('uint')) ? 'number' : 'text'}
              id={field.name}
              name={field.name}
              className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              value={responseData ? formatResponseValue(responseData[field.name], field.type) : values[field.name]}
              onChange={handleChange}
              min={(field.type.includes('uint')) ? "0" : undefined}
              readOnly={!!responseData}
            />
          )}
          {jsonErrors[field.name] && <p className="text-xs text-red-400 mt-1">{jsonErrors[field.name]}</p>}
          {renderInputGuidance(field)}
        </div>
      ))}
      
      {!hideSubmitButton && !responseData && (
        <button 
          type="submit"
          className={`w-full px-4 py-2 rounded font-semibold text-white transition duration-150 ease-in-out ${isTransaction ? 'bg-yellow-600 hover:bg-yellow-700 disabled:bg-yellow-800' : 'bg-green-600 hover:bg-green-700 disabled:bg-green-800'} disabled:opacity-60 disabled:cursor-not-allowed`}
        >
          {isTransaction ? 'Submit Inputs' : 'Query Contract'}
        </button>
      )}
    </form>
  );
};

export default DynamicForm;