import { Response } from 'express';
import { AuthRequest } from '../types';
import { OrderStatus } from '@prisma/client';
import orderService from '../services/orderService';
import { Parser } from 'json2csv';
import * as XLSX from 'xlsx';
import { parse } from 'csv-parse/sync';
import logger from '../utils/logger';

export const exportOrders = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const {
            status,
            customerId,
            customerRepId,
            deliveryAgentId,
            area,
            startDate,
            endDate,
            search,
            format = 'csv'
        } = req.query;

        // Parse status - can be a single value or array
        let parsedStatus: OrderStatus[] | undefined;
        if (status) {
            parsedStatus = Array.isArray(status) ? status as OrderStatus[] : [status as OrderStatus];
        }

        // Role-based filtering (logic duplicated from orderController for consistency)
        let effectiveCustomerRepId = customerRepId ? Number(customerRepId) : undefined;
        if (req.user?.role === 'sales_rep') {
            effectiveCustomerRepId = req.user.id;
        }

        let effectiveDeliveryAgentId = deliveryAgentId ? Number(deliveryAgentId) : undefined;
        if (req.user?.role === 'delivery_agent') {
            effectiveDeliveryAgentId = req.user.id;
        }

        // Fetch orders without pagination for export (limit to 10000 to prevent memory blowup)
        const result = await orderService.getAllOrders({
            status: parsedStatus,
            customerId: customerId ? Number(customerId) : undefined,
            customerRepId: effectiveCustomerRepId,
            deliveryAgentId: effectiveDeliveryAgentId,
            area: area as string | undefined,
            startDate: startDate ? new Date(startDate as string) : undefined,
            endDate: endDate ? new Date(endDate as string) : undefined,
            search: search as string | undefined,
            page: 1,
            limit: 10000 // High limit for export
        });

        const orders = result.orders.map(order => ({
            'Date': order.createdAt.toISOString().split('T')[0],
            'Customer Name': `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim(),
            'Phone': order.customer?.phoneNumber || '',
            'Alternative Phone': order.customer?.alternatePhone || '',
            'Address': order.deliveryAddress,
            'Area': order.deliveryArea,
            'State': order.deliveryState,
            'Product Name': order.orderItems?.[0]?.product?.name || '',
            'Quantity': order.orderItems?.[0]?.quantity || 0,
            'Total Amount': order.totalAmount,
            'Status': order.status,
            'Customer Rep': order.customerRep ? `${order.customerRep.firstName} ${order.customerRep.lastName}` : 'Unassigned',
            'Delivery Agent': order.deliveryAgent ? `${order.deliveryAgent.firstName} ${order.deliveryAgent.lastName}` : 'Unassigned',
            'Order ID': order.id,
            'Notes': order.notes || ''
        }));

        if (format === 'xlsx') {
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(orders);
            XLSX.utils.book_append_sheet(wb, ws, 'Orders');
            const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=orders_export_${Date.now()}.xlsx`);
            res.send(buffer);
        } else {
            const json2csvParser = new Parser();
            const csv = json2csvParser.parse(orders);

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=orders_export_${Date.now()}.csv`);
            res.send(csv);
        }
    } catch (error) {
        logger.error('Export orders failed', { error });
        res.status(500).json({ message: 'Export failed' });
    }
};

export const uploadOrders = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        if (!req.file) {
            res.status(400).json({ message: 'No file uploaded' });
            return;
        }

        let rawData: any[] = [];
        const extension = req.file.originalname.split('.').pop()?.toLowerCase();

        if (extension === 'csv') {
            rawData = parse(req.file.buffer, {
                columns: true,
                skip_empty_lines: true,
                trim: true
            });
        } else if (extension === 'xlsx' || extension === 'xls') {
            const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
        } else {
            res.status(400).json({ message: 'Unsupported file format' });
            return;
        }

        // Map raw data to BulkImportOrderData interface
        const mappedOrders = rawData.map(row => {
            const customerPhone = String(row['PHONE NUMBER'] || row['Phone'] || row['phone'] || '').trim();
            const customerName = String(row['CUSTOMER NAME'] || row['Customer Name'] || row['name'] || '').trim();
            const nameParts = customerName.split(' ');

            const price = Number(row['PRICE'] || row['Price'] || row['Total Amount'] || row['total'] || 0);
            const quantity = Number(row['QUANTITY'] || row['Quantity'] || 1);
            const totalAmount = price * quantity;

            // Validate status
            let status: OrderStatus | undefined;
            const rawStatus = String(row['ORDER STATUS'] || row['Status'] || '').toLowerCase().replace(/ /g, '_');
            if (Object.values(OrderStatus).includes(rawStatus as OrderStatus)) {
                status = rawStatus as OrderStatus;
            }

            return {
                customerPhone,
                customerFirstName: nameParts[0] || 'Unknown',
                customerLastName: nameParts.slice(1).join(' ') || '',
                customerAlternatePhone: String(row['ALTERNATIVE PHONE NUMBER'] || row['Alt Phone'] || '').trim(),
                subtotal: totalAmount,
                totalAmount: totalAmount,
                deliveryAddress: String(row['CUSTOMER ADDRESS'] || row['Address'] || '').trim(),
                deliveryState: String(row['REGION'] || row['Region'] || row['State'] || '').trim(),
                deliveryArea: String(row['REGION'] || row['Region'] || row['Area'] || '').trim(),
                productName: String(row['PRODUCT NAME'] || row['Product'] || '').trim(),
                quantity: quantity,
                unitPrice: price,
                status: status,
                notes: String(row['Notes'] || '').trim()
            };
        }).filter(o => o.customerPhone && o.totalAmount > 0);

        if (mappedOrders.length === 0) {
            res.status(400).json({ message: 'No valid orders found in file' });
            return;
        }

        const results = await orderService.bulkImportOrders(mappedOrders, req.user?.id);
        res.json({ results });
    } catch (error: any) {
        logger.error('Upload orders failed', { error: error.message });
        res.status(500).json({ message: 'Upload failed', error: error.message });
    }
};
