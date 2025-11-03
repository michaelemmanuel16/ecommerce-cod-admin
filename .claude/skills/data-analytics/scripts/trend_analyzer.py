#!/usr/bin/env python3
"""
Trend Analyzer Script
---------------------
Statistical analysis and forecasting for time series data.

Usage:
    python trend_analyzer.py <operation> --input <file> --output <file> [options]

Operations:
    - forecast: Simple moving average or exponential smoothing forecast
    - detect-trends: Identify upward/downward trends
    - seasonality: Detect seasonal patterns
    - outliers: Identify anomalies in data

Examples:
    # Forecast next 7 days
    python trend_analyzer.py forecast --input sales.json --output forecast.json --periods 7 --method ema

    # Detect trends
    python trend_analyzer.py detect-trends --input sales.json --output trends.json --window 7
"""

import json
import sys
import argparse
from typing import List, Dict, Any
from statistics import mean, stdev
import math


def simple_moving_average_forecast(data: List[Dict], value_field: str,
                                   periods: int, window: int = 7) -> List[Dict]:
    """
    Forecast using simple moving average.

    Args:
        data: Historical time series data
        value_field: Field to forecast
        periods: Number of periods to forecast
        window: Window size for moving average

    Returns:
        List of forecast dictionaries
    """
    if len(data) < window:
        raise ValueError(f"Need at least {window} data points for forecasting")

    # Calculate moving average from last window
    recent_values = [item[value_field] for item in data[-window:]]
    forecast_value = mean(recent_values)

    forecasts = []
    for i in range(1, periods + 1):
        forecasts.append({
            'period': i,
            'forecast': round(forecast_value, 2),
            'type': 'forecast'
        })

    return forecasts


def exponential_smoothing_forecast(data: List[Dict], value_field: str,
                                   periods: int, alpha: float = 0.3) -> List[Dict]:
    """
    Forecast using exponential smoothing.

    Args:
        data: Historical time series data
        value_field: Field to forecast
        periods: Number of periods to forecast
        alpha: Smoothing parameter (0-1)

    Returns:
        List of forecast dictionaries
    """
    if not data:
        raise ValueError("Need historical data for forecasting")

    # Calculate initial smoothed value
    smoothed = data[0][value_field]

    # Apply exponential smoothing to historical data
    for item in data[1:]:
        smoothed = alpha * item[value_field] + (1 - alpha) * smoothed

    # Forecast is constant (simple exponential smoothing)
    forecasts = []
    for i in range(1, periods + 1):
        forecasts.append({
            'period': i,
            'forecast': round(smoothed, 2),
            'type': 'forecast',
            'confidence': 'medium'
        })

    return forecasts


def detect_trends(data: List[Dict], value_field: str, window: int = 7) -> List[Dict]:
    """
    Detect upward/downward trends in data.

    Args:
        data: Time series data
        value_field: Field to analyze
        window: Window size for trend detection

    Returns:
        Data with trend indicators added
    """
    results = []

    for i, item in enumerate(data):
        result = item.copy()

        if i >= window:
            # Calculate average of current window and previous window
            current_window = [data[j][value_field] for j in range(i - window + 1, i + 1)]
            previous_window = [data[j][value_field] for j in range(i - 2 * window + 1, i - window + 1)]

            current_avg = mean(current_window)
            previous_avg = mean(previous_window)

            # Determine trend
            change_pct = ((current_avg - previous_avg) / previous_avg * 100) if previous_avg != 0 else 0

            if change_pct > 5:
                result['trend'] = 'up'
                result['trend_strength'] = 'strong' if change_pct > 15 else 'moderate'
            elif change_pct < -5:
                result['trend'] = 'down'
                result['trend_strength'] = 'strong' if change_pct < -15 else 'moderate'
            else:
                result['trend'] = 'stable'
                result['trend_strength'] = 'none'

            result['trend_change_pct'] = round(change_pct, 2)
        else:
            result['trend'] = 'insufficient_data'
            result['trend_strength'] = 'none'
            result['trend_change_pct'] = 0

        results.append(result)

    return results


def detect_seasonality(data: List[Dict], value_field: str, period: int = 7) -> Dict[str, Any]:
    """
    Detect seasonal patterns.

    Args:
        data: Time series data
        value_field: Field to analyze
        period: Seasonal period (e.g., 7 for weekly)

    Returns:
        Dictionary with seasonality analysis
    """
    if len(data) < period * 2:
        return {
            'has_seasonality': False,
            'message': 'Insufficient data for seasonality detection'
        }

    # Group by position in cycle
    cycle_values = [[] for _ in range(period)]

    for i, item in enumerate(data):
        position = i % period
        cycle_values[position].append(item[value_field])

    # Calculate average for each position
    cycle_averages = [mean(values) if values else 0 for values in cycle_values]
    overall_mean = mean([item[value_field] for item in data])

    # Calculate coefficient of variation
    if overall_mean != 0:
        cycle_variation = [abs(avg - overall_mean) / overall_mean * 100 for avg in cycle_averages]
        avg_variation = mean(cycle_variation)

        has_seasonality = avg_variation > 10  # More than 10% variation suggests seasonality
    else:
        has_seasonality = False
        avg_variation = 0

    return {
        'has_seasonality': has_seasonality,
        'period': period,
        'cycle_averages': [round(avg, 2) for avg in cycle_averages],
        'variation_pct': round(avg_variation, 2),
        'interpretation': 'Strong seasonal pattern' if avg_variation > 20 else 'Moderate seasonal pattern' if avg_variation > 10 else 'No clear seasonality'
    }


def detect_outliers(data: List[Dict], value_field: str, threshold: float = 2.0) -> List[Dict]:
    """
    Detect outliers using standard deviation method.

    Args:
        data: Time series data
        value_field: Field to analyze
        threshold: Number of standard deviations for outlier threshold

    Returns:
        Data with outlier flags added
    """
    values = [item[value_field] for item in data]
    avg = mean(values)

    if len(values) > 1:
        sd = stdev(values)
    else:
        sd = 0

    results = []
    for item in data:
        result = item.copy()
        value = item[value_field]

        if sd > 0:
            z_score = abs((value - avg) / sd)
            is_outlier = z_score > threshold

            result['is_outlier'] = is_outlier
            result['z_score'] = round(z_score, 2)

            if is_outlier:
                result['outlier_type'] = 'high' if value > avg else 'low'
        else:
            result['is_outlier'] = False
            result['z_score'] = 0

        results.append(result)

    return results


def calculate_statistics(data: List[Dict], value_field: str) -> Dict[str, float]:
    """
    Calculate basic statistical measures.

    Args:
        data: Time series data
        value_field: Field to analyze

    Returns:
        Dictionary of statistical measures
    """
    values = [item[value_field] for item in data]

    if not values:
        return {}

    stats = {
        'count': len(values),
        'mean': round(mean(values), 2),
        'min': round(min(values), 2),
        'max': round(max(values), 2),
        'range': round(max(values) - min(values), 2)
    }

    if len(values) > 1:
        stats['std_dev'] = round(stdev(values), 2)
        stats['coefficient_of_variation'] = round((stdev(values) / mean(values) * 100), 2) if mean(values) != 0 else 0

    # Calculate percentiles
    sorted_values = sorted(values)
    stats['median'] = sorted_values[len(sorted_values) // 2]
    stats['p25'] = sorted_values[len(sorted_values) // 4]
    stats['p75'] = sorted_values[3 * len(sorted_values) // 4]

    return stats


def main():
    parser = argparse.ArgumentParser(description='Statistical analysis and forecasting')
    parser.add_argument('operation',
                       choices=['forecast', 'detect-trends', 'seasonality', 'outliers', 'statistics'],
                       help='Operation to perform')
    parser.add_argument('--input', required=True, help='Input JSON file')
    parser.add_argument('--output', required=True, help='Output JSON file')
    parser.add_argument('--value-field', help='Field name to analyze')

    # Forecast options
    parser.add_argument('--periods', type=int, default=7, help='Number of periods to forecast')
    parser.add_argument('--method', choices=['sma', 'ema'], default='sma',
                       help='Forecasting method (sma=Simple Moving Average, ema=Exponential Smoothing)')
    parser.add_argument('--window', type=int, default=7, help='Window size for moving average')
    parser.add_argument('--alpha', type=float, default=0.3, help='Smoothing parameter for EMA (0-1)')

    # Trend detection options
    parser.add_argument('--trend-window', type=int, default=7, help='Window size for trend detection')

    # Seasonality options
    parser.add_argument('--period', type=int, default=7, help='Seasonal period (e.g., 7 for weekly)')

    # Outlier detection options
    parser.add_argument('--threshold', type=float, default=2.0,
                       help='Standard deviation threshold for outliers')

    args = parser.parse_args()

    # Read input data
    try:
        with open(args.input, 'r') as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"Error: Input file '{args.input}' not found", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON in input file: {e}", file=sys.stderr)
        sys.exit(1)

    # Perform operation
    if args.operation == 'forecast':
        if not args.value_field:
            print("Error: --value-field is required for forecast", file=sys.stderr)
            sys.exit(1)

        if args.method == 'sma':
            result = simple_moving_average_forecast(data, args.value_field, args.periods, args.window)
        elif args.method == 'ema':
            result = exponential_smoothing_forecast(data, args.value_field, args.periods, args.alpha)

        print(f"✅ Generated forecast for {args.periods} periods using {args.method.upper()}")

    elif args.operation == 'detect-trends':
        if not args.value_field:
            print("Error: --value-field is required for trend detection", file=sys.stderr)
            sys.exit(1)

        result = detect_trends(data, args.value_field, args.trend_window)
        print(f"✅ Analyzed trends with {args.trend_window}-period window")

    elif args.operation == 'seasonality':
        if not args.value_field:
            print("Error: --value-field is required for seasonality analysis", file=sys.stderr)
            sys.exit(1)

        result = detect_seasonality(data, args.value_field, args.period)
        print(f"✅ Seasonality analysis complete")
        print(f"   Has seasonality: {result['has_seasonality']}")
        print(f"   {result.get('interpretation', '')}")

    elif args.operation == 'outliers':
        if not args.value_field:
            print("Error: --value-field is required for outlier detection", file=sys.stderr)
            sys.exit(1)

        result = detect_outliers(data, args.value_field, args.threshold)
        outlier_count = sum(1 for item in result if item.get('is_outlier', False))
        print(f"✅ Outlier detection complete")
        print(f"   Found {outlier_count} outliers out of {len(result)} data points")

    elif args.operation == 'statistics':
        if not args.value_field:
            print("Error: --value-field is required for statistics", file=sys.stderr)
            sys.exit(1)

        result = calculate_statistics(data, args.value_field)
        print(f"✅ Statistical analysis complete")
        print(f"   Mean: {result.get('mean', 0)}, Std Dev: {result.get('std_dev', 0)}")

    # Write output
    try:
        with open(args.output, 'w') as f:
            json.dump(result, f, indent=2)
        print(f"   Output written to '{args.output}'")
    except IOError as e:
        print(f"Error writing output file: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
