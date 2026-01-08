import React, { useState, useRef } from 'react';
import { X, Upload, Download, AlertCircle, CheckCircle2, FileText, Loader2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { ordersService } from '../../services/orders.service';
import toast from 'react-hot-toast';

interface BulkImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export const BulkImportModal: React.FC<BulkImportModalProps> = ({ isOpen, onClose, onSuccess }) => {
    const [file, setFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [results, setResults] = useState<any | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    if (!isOpen) return null;

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            if (selectedFile.size > 10 * 1024 * 1024) {
                toast.error('File size exceeds 10MB');
                return;
            }
            setFile(selectedFile);
            setResults(null);
        }
    };

    const handleUpload = async () => {
        if (!file) return;

        setIsUploading(true);
        try {
            const data = await ordersService.uploadOrders(file);
            setResults(data.results);
            if (data.results.success > 0) {
                toast.success(`Successfully imported ${data.results.success} orders`);
                onSuccess();
            }
            if (data.results.failed > 0) {
                toast.error(`Failed to import ${data.results.failed} orders`);
            }
        } catch (error: any) {
            console.error('Upload failed:', error);
            toast.error(error.response?.data?.message || 'Upload failed');
        } finally {
            setIsUploading(false);
        }
    };

    const handleDownloadTemplate = () => {
        const headers = [
            'DATE [dd/mm/yyyy]',
            'CUSTOMER NAME',
            'PHONE NUMBER',
            'ALTERNATIVE PHONE NUMBER',
            'CUSTOMER ADDRESS',
            'REGION',
            'PRODUCT NAME',
            'QUANTITY',
            'PRICE',
            'ORDER STATUS',
            'Assigned Rep'
        ];
        const csvContent = "data:text/csv;charset=utf-8," + headers.join(",");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "order_import_template.csv");
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    const reset = () => {
        setFile(null);
        setResults(null);
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleClose = () => {
        reset();
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-white sticky top-0">
                    <h2 className="text-xl font-bold text-gray-900">Import Orders</h2>
                    <button onClick={handleClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto">
                    {!results ? (
                        <div className="space-y-6">
                            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                                <div className="text-sm text-blue-800">
                                    <p className="font-semibold mb-1">Before you upload:</p>
                                    <ul className="list-disc list-inside space-y-1 text-blue-700/80">
                                        <li>Required fields: Customer Phone, Total Amount</li>
                                        <li>Formats supported: .csv, .xlsx, .xls</li>
                                        <li>Maximum file size: 10MB</li>
                                    </ul>
                                    <button
                                        onClick={handleDownloadTemplate}
                                        className="mt-3 flex items-center gap-2 text-blue-600 font-medium hover:underline"
                                    >
                                        <Download className="w-4 h-4" />
                                        Download Sample Template
                                    </button>
                                </div>
                            </div>

                            <div
                                onClick={() => fileInputRef.current?.click()}
                                className={`border-2 border-dashed rounded-xl p-10 text-center transition-all cursor-pointer ${file ? 'border-blue-300 bg-blue-50/30' : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                                    }`}
                            >
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleFileChange}
                                    className="hidden"
                                    accept=".csv,.xlsx,.xls"
                                />

                                {file ? (
                                    <div className="flex flex-col items-center">
                                        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                                            <FileText className="w-8 h-8 text-blue-600" />
                                        </div>
                                        <p className="text-lg font-semibold text-gray-900 mb-1">{file.name}</p>
                                        <p className="text-sm text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); reset(); }}
                                            className="mt-4 text-sm text-red-600 font-medium hover:underline"
                                        >
                                            Remove file
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center">
                                        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                                            <Upload className="w-8 h-8 text-gray-400" />
                                        </div>
                                        <p className="text-lg font-semibold text-gray-900 mb-1">Click to upload or drag and drop</p>
                                        <p className="text-sm text-gray-500">Spreadsheet files only (CSV, Excel)</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                                <div className="flex gap-8">
                                    <div className="text-center">
                                        <p className="text-2xl font-bold text-green-600">{results.success}</p>
                                        <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Successful</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-2xl font-bold text-red-600">{results.failed}</p>
                                        <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Failed</p>
                                    </div>
                                </div>
                                {results.failed === 0 && results.success > 0 ? (
                                    <div className="flex items-center gap-2 text-green-600 font-medium bg-green-50 px-3 py-1.5 rounded-full border border-green-100">
                                        <CheckCircle2 className="w-4 h-4" />
                                        All orders imported
                                    </div>
                                ) : results.success > 0 ? (
                                    <div className="text-sm text-amber-600 bg-amber-50 px-3 py-1.5 rounded-full border border-amber-100">
                                        Partial success
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2 text-red-600 font-medium bg-red-50 px-3 py-1.5 rounded-full border border-red-100">
                                        <AlertCircle className="w-4 h-4" />
                                        Import failed
                                    </div>
                                )}
                            </div>

                            {results.errors?.length > 0 && (
                                <div className="space-y-3">
                                    <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Error Details</h3>
                                    <div className="border border-gray-100 rounded-lg divide-y divide-gray-100 overflow-hidden max-h-60 overflow-y-auto">
                                        {results.errors.map((err: any, idx: number) => (
                                            <div key={idx} className="p-3 bg-white hover:bg-gray-50 transition-colors">
                                                <div className="flex items-start justify-between gap-4">
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-semibold text-gray-900 truncate">
                                                            Phone: {err.order?.customerPhone || 'Unknown'}
                                                        </p>
                                                        <p className="text-xs text-red-600 mt-1">{err.error}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <Button variant="ghost" className="w-full" onClick={reset}>
                                Import Another File
                            </Button>
                        </div>
                    )}
                </div>

                <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-3 sticky bottom-0">
                    <Button variant="ghost" onClick={handleClose} disabled={isUploading}>
                        {results ? 'Close' : 'Cancel'}
                    </Button>
                    {!results && (
                        <Button
                            variant="primary"
                            onClick={handleUpload}
                            disabled={!file || isUploading}
                            isLoading={isUploading}
                        >
                            <Upload className="w-4 h-4 mr-2" />
                            Start Import
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};
