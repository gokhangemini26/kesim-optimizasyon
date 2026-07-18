// C:\Users\ggule\Desktop\kesim içindeki gerçek kesim çalışmaları.
// Kumaş top/çekme verileri MIRA / PIETRA / TROPE çekme ölçüm dosyalarından alındı.

export const CASES = [
    {
        name: '11S188 90936',
        file: '11S188 90936--704 AD.XLSX',
        human: { cuts: 11, planned: 714, note: '2 kalıp (E35 B6 / E55 B6)' },
        params: { consumptionMode: 'AVG', avgConsumption: 1.38, sizeConsumptions: {} },
        allocation: {
            18: 'LOT1', 525: 'LOT1', 842: 'LOT1',
            841: 'LOT2', '018USA': 'LOT2', '525USA': 'LOT2', '842USA': 'LOT2'
        },
        orderRows: [
            { color: '18', quantities: { 28: 1, 29: 1, 30: 6, 31: 19, 32: 35, 33: 35, 34: 42, 35: 18, 36: 27, 38: 12, 40: 3 } },
            { color: '525', quantities: { 29: 2, 30: 6, 31: 14, 32: 26, 33: 25, 34: 25, 35: 9, 36: 24, 38: 9, 40: 3 } },
            { color: '841', quantities: { 30: 2, 31: 7, 32: 20, 33: 21, 34: 23, 35: 7, 36: 11, 38: 5, 40: 1 } },
            { color: '842', quantities: { 28: 1, 29: 1, 30: 6, 31: 21, 32: 34, 33: 32, 34: 37, 35: 19, 36: 32, 38: 17, 40: 5 } },
            { color: '018USA', quantities: { 29: 1, 30: 1, 31: 2, 32: 3, 33: 3, 34: 3, 36: 2, 38: 2, 40: 1 } },
            { color: '525USA', quantities: { 29: 2, 30: 2, 31: 3, 32: 4, 33: 4, 34: 4, 36: 2, 38: 2, 40: 1 } },
            { color: '842USA', quantities: { 29: 1, 30: 1, 31: 2, 32: 3, 33: 3, 34: 3, 36: 2, 38: 2, 40: 1 } }
        ],
        fabricRows: [
            { topNo: '5', lot: 'LOT1', cekme: 'E35 B6', metraj: 118.82 },
            { topNo: '28', lot: 'LOT1', cekme: 'E35 B6', metraj: 125 },
            { topNo: '30', lot: 'LOT1', cekme: 'E35 B6', metraj: 93.44 },
            { topNo: '38', lot: 'LOT1', cekme: 'E35 B6', metraj: 36.21 },
            { topNo: '18', lot: 'LOT1', cekme: 'E55 B6', metraj: 20 },
            { topNo: '19', lot: 'LOT1', cekme: 'E55 B6', metraj: 143 },
            { topNo: '35', lot: 'LOT1', cekme: 'E55 B6', metraj: 80 },
            { topNo: '36', lot: 'LOT1', cekme: 'E55 B6', metraj: 129 },
            { topNo: '11', lot: 'LOT2', cekme: 'E55 B6', metraj: 115 },
            { topNo: '12', lot: 'LOT2', cekme: 'E55 B6', metraj: 110.98 },
            { topNo: '20', lot: 'LOT2', cekme: 'E55 B6', metraj: 97.76 }
        ]
    },
    {
        name: '18S100 9664C',
        file: '18S100 9664C--1997 AD.XLSX',
        human: { cuts: 23, planned: 2023, note: '9 lot, 2 kalıp; 710 rengi LOT7+15 bölünmüş' },
        params: { consumptionMode: 'AVG', avgConsumption: 1.31, sizeConsumptions: {} },
        allocation: {
            18: 'LOT11', 121: 'LOT11',
            401: 'LOT8', 411: 'LOT8', 417: 'LOT8', 519: 'LOT8', 910: 'LOT8',
            620: 'LOT9', 833: 'LOT9', 924: 'LOT9', '620USA': 'LOT9',
            700: 'LOT10', '710USA': 'LOT10',
            710: 'LOT7+LOT15',
            824: 'LOT12', '924USA': 'LOT12',
            842: 'LOT13',
            '401USA': 'LOT14', '417USA': 'LOT14'
        },
        orderRows: [
            { color: '18', quantities: { 30: 2, 31: 9, 32: 12, 33: 16, 34: 15, 35: 8, 36: 14, 38: 6, 40: 5 } },
            { color: '121', quantities: { 29: 3, 30: 5, 31: 6, 32: 8, 33: 8, 34: 9, 35: 4, 36: 6, 38: 1 } },
            { color: '401', quantities: { 29: 3, 30: 8, 31: 20, 32: 39, 33: 43, 34: 50, 35: 23, 36: 40, 38: 20, 40: 8, 42: 1 } },
            { color: '411', quantities: { 29: 6, 30: 14, 31: 21, 32: 25, 33: 23, 34: 21, 35: 9, 36: 16, 38: 7, 40: 4 } },
            { color: '417', quantities: { 28: 1, 29: 3, 30: 6, 31: 15, 32: 25, 33: 28, 34: 31, 35: 16, 36: 31, 38: 16, 40: 9 } },
            { color: '519', quantities: { 29: 2, 30: 8, 31: 14, 32: 19, 33: 28, 34: 27, 35: 15, 36: 21, 38: 11, 40: 1 } },
            { color: '700', quantities: { 30: 3, 31: 14, 32: 23, 33: 32, 34: 32, 35: 14, 36: 23, 38: 11 } },
            { color: '710', quantities: { 28: 1, 29: 1, 30: 2, 31: 7, 32: 14, 33: 13, 34: 19, 35: 8, 36: 19, 38: 8, 40: 5 } },
            { color: '842', quantities: { 29: 1, 30: 7, 31: 9, 32: 11, 33: 11, 34: 8, 35: 5, 36: 3, 38: 1 } },
            { color: '910', quantities: { 29: 6, 30: 13, 31: 17, 32: 15, 33: 14, 34: 11, 35: 4, 36: 6, 38: 2 } },
            { color: '401USA', quantities: { 29: 2, 30: 2, 31: 3, 32: 4, 33: 4, 34: 4, 36: 2, 38: 2, 40: 1 } },
            { color: '417USA', quantities: { 29: 2, 30: 2, 31: 3, 32: 6, 33: 5, 34: 5, 36: 3, 38: 3, 40: 1 } },
            { color: '710USA', quantities: { 29: 1, 30: 1, 31: 2, 32: 3, 33: 3, 34: 3, 36: 2, 38: 2, 40: 1 } },
            { color: '620', quantities: { 28: 1, 29: 3, 30: 11, 31: 17, 32: 25, 33: 22, 34: 20, 35: 3, 36: 14, 38: 6, 40: 3 } },
            { color: '824', quantities: { 29: 4, 30: 16, 31: 28, 32: 48, 33: 49, 34: 44, 35: 21, 36: 30, 38: 21, 40: 5, 42: 3 } },
            { color: '833', quantities: { 30: 3, 31: 6, 32: 7, 33: 9, 34: 9, 35: 7, 36: 6, 38: 4, 40: 3 } },
            { color: '924', quantities: { 28: 1, 29: 4, 30: 15, 31: 25, 32: 31, 33: 28, 34: 27, 35: 8, 36: 19, 38: 9, 40: 4 } },
            { color: '620USA', quantities: { 29: 1, 30: 1, 31: 2, 32: 3, 33: 3, 34: 3, 36: 2, 38: 2, 40: 1 } },
            { color: '924USA', quantities: { 29: 2, 30: 2, 31: 3, 32: 6, 33: 5, 34: 5, 36: 3, 38: 3, 40: 1 } }
        ],
        fabricRows: [
            { topNo: '44', lot: 'LOT8', cekme: 'E35 B35', metraj: 137.5 },
            { topNo: '45', lot: 'LOT8', cekme: 'E35 B35', metraj: 129.21 },
            { topNo: '51', lot: 'LOT8', cekme: 'E35 B35', metraj: 131.48 },
            { topNo: '52', lot: 'LOT8', cekme: 'E35 B35', metraj: 131 },
            { topNo: '53', lot: 'LOT8', cekme: 'E35 B35', metraj: 77.05 },
            { topNo: '63', lot: 'LOT8', cekme: 'E35 B35', metraj: 36.72 },
            { topNo: '73', lot: 'LOT9', cekme: 'E35 B35', metraj: 130.17 },
            { topNo: '74', lot: 'LOT9', cekme: 'E35 B35', metraj: 129.25 },
            { topNo: '75', lot: 'LOT9', cekme: 'E35 B35', metraj: 129.29 },
            { topNo: '76', lot: 'LOT9', cekme: 'E35 B35', metraj: 112.83 },
            { topNo: '39', lot: 'LOT10', cekme: 'E35 B35', metraj: 131.8 },
            { topNo: '40', lot: 'LOT10', cekme: 'E35 B35', metraj: 102.88 },
            { topNo: '46', lot: 'LOT11', cekme: 'E35 B35', metraj: 58.07 },
            { topNo: '84', lot: 'LOT12', cekme: 'E35 B35', metraj: 90.1 },
            { topNo: '85', lot: 'LOT12', cekme: 'E35 B35', metraj: 88.07 },
            { topNo: '92', lot: 'LOT13', cekme: 'E35 B35', metraj: 90.64 },
            { topNo: '37', lot: 'LOT7', cekme: 'E2 B35', metraj: 97.6 },
            { topNo: '38', lot: 'LOT8', cekme: 'E2 B35', metraj: 137.26 },
            { topNo: '54', lot: 'LOT8', cekme: 'E2 B35', metraj: 132.4 },
            { topNo: '56', lot: 'LOT8', cekme: 'E2 B35', metraj: 132 },
            { topNo: '62', lot: 'LOT8', cekme: 'E2 B35', metraj: 126.7 },
            { topNo: '79', lot: 'LOT11', cekme: 'E2 B35', metraj: 131.8 },
            { topNo: '82', lot: 'LOT12', cekme: 'E2 B35', metraj: 90 },
            { topNo: '83', lot: 'LOT12', cekme: 'E2 B35', metraj: 68.11 },
            { topNo: '88', lot: 'LOT12', cekme: 'E2 B35', metraj: 94.6 },
            { topNo: '86', lot: 'LOT14', cekme: 'E2 B35', metraj: 89.94 },
            { topNo: '89', lot: 'LOT15', cekme: 'E2 B35', metraj: 89.75 }
        ]
    },
    {
        name: '18S100 9809A',
        file: '18S100 9809A-484 AD.XLSX',
        human: { cuts: 7, planned: 489, note: 'Tek lot (TEMİZ); UD (dönmeli) + normal kalıp' },
        params: { consumptionMode: 'AVG', avgConsumption: 1.24, sizeConsumptions: {} },
        allocation: {
            18: 'TEMİZ', 300: 'TEMİZ', 424: 'TEMİZ', 700: 'TEMİZ', 750: 'TEMİZ',
            824: 'TEMİZ', 833: 'TEMİZ', 910: 'TEMİZ', 932: 'TEMİZ'
        },
        orderRows: [
            { color: '18', quantities: { 29: 3, 30: 6, 31: 8, 32: 9, 33: 9, 34: 7, 36: 4, 38: 2 } },
            { color: '300', quantities: { 29: 6, 30: 6, 31: 12, 32: 10, 33: 10, 34: 4, 36: 2 } },
            { color: '424', quantities: { 29: 6, 30: 11, 31: 12, 32: 13, 33: 11, 34: 8, 36: 4, 38: 2 } },
            { color: '700', quantities: { 29: 1, 30: 1, 31: 8, 32: 12, 33: 9, 34: 10, 36: 9 } },
            { color: '750', quantities: { 30: 9, 31: 9, 32: 12, 33: 9, 34: 7, 36: 4 } },
            { color: '824', quantities: { 29: 5, 30: 7, 31: 9, 32: 10, 33: 9, 34: 6, 36: 2 } },
            { color: '833', quantities: { 29: 3, 30: 5, 31: 12, 32: 10, 33: 9, 34: 7, 35: 1, 36: 3 } },
            { color: '910', quantities: { 29: 5, 30: 7, 31: 12, 32: 11, 33: 10, 34: 7, 36: 4 } },
            { color: '932', quantities: { 29: 2, 30: 8, 31: 14, 32: 18, 33: 6, 34: 10, 35: 4, 36: 3 } }
        ],
        fabricRows: [
            { topNo: '5', lot: 'TEMİZ', cekme: 'E35 B2', metraj: 102.82 },
            { topNo: '6', lot: 'TEMİZ', cekme: 'E35 B2', metraj: 102.96 },
            { topNo: '7', lot: 'TEMİZ', cekme: 'E35 B2', metraj: 102.19 },
            { topNo: '10', lot: 'TEMİZ', cekme: 'E35 B2', metraj: 85.56 },
            { topNo: '11', lot: 'TEMİZ', cekme: 'E35 B2', metraj: 91.04 },
            { topNo: '16', lot: 'TEMİZ', cekme: 'E35 B2', metraj: 76.42 },
            { topNo: '21', lot: 'TEMİZ', cekme: 'E35 B2', metraj: 29.1 },
            { topNo: '23', lot: 'TEMİZ', cekme: 'E35 B2', metraj: 22 },
            { topNo: '3', lot: 'TEMİZ', cekme: 'UD E35 B2', metraj: 102.44 },
            { topNo: '9', lot: 'TEMİZ', cekme: 'UD E35 B2', metraj: 54.39 },
            { topNo: '12', lot: 'TEMİZ', cekme: 'UD E35 B2', metraj: 102.87 },
            { topNo: '13', lot: 'TEMİZ', cekme: 'UD E35 B2', metraj: 110.53 }
        ]
    },
    {
        name: 'C31300-30Q CLIFTON',
        file: 'C31300-30Q CLIFTON TRUE--2082 AD.XLSX',
        human: { cuts: 31, planned: 2096, note: '5 kalıp; 568→LOT2+8, 123→LOT4+7+5 bölünmüş' },
        params: { consumptionMode: 'AVG', avgConsumption: 1.36, sizeConsumptions: {} },
        engineParams: { maxSizesPerMarker: 3 },
        allocation: {
            920: 'LOT1',
            568: 'LOT2+LOT8',
            565: 'LOT3', 696: 'LOT3',
            123: 'LOT4+LOT7+LOT5'
        },
        orderRows: [
            { color: '123', quantities: { '29/32': 11, '30/32': 28, '31/32': 44, '32/32': 61, '33/32': 59, '34/32': 54, '36/32': 28, '38/32': 10, '30/34': 3, '31/34': 17, '32/34': 27, '33/34': 34, '34/34': 40, '36/34': 23, '38/34': 8 } },
            { color: '565', quantities: { '29/32': 3, '30/32': 10, '31/32': 16, '32/32': 22, '33/32': 22, '34/32': 19, '36/32': 10, '38/32': 4, '30/34': 4, '31/34': 4, '32/34': 5, '33/34': 8, '34/34': 12, '36/34': 8, '38/34': 3 } },
            { color: '568', quantities: { '28/32': 4, '29/32': 18, '30/32': 47, '31/32': 70, '32/32': 101, '33/32': 93, '34/32': 87, '36/32': 50, '38/32': 10, '31/34': 25, '32/34': 44, '33/34': 48, '34/34': 57, '36/34': 32, '38/34': 7 } },
            { color: '696', quantities: { '28/32': 3, '29/32': 7, '30/32': 12, '31/32': 18, '32/32': 22, '33/32': 21, '34/32': 17, '36/32': 7, '38/32': 3, '31/34': 2, '32/34': 6, '33/34': 8, '34/34': 14, '36/34': 8, '38/34': 2 } },
            { color: '920', quantities: { '28/32': 4, '29/32': 17, '30/32': 46, '31/32': 66, '32/32': 94, '33/32': 85, '34/32': 82, '36/32': 44, '38/32': 9, '31/34': 22, '32/34': 40, '33/34': 46, '34/34': 51, '36/34': 30, '38/34': 6 } }
        ],
        fabricRows: [
            { topNo: '1', lot: 'LOT4', cekme: 'E2 B35', metraj: 103 },
            { topNo: '10', lot: 'LOT1', cekme: 'E2 B35', metraj: 118 },
            { topNo: '53', lot: 'LOT7', cekme: 'E2 B35', metraj: 74 },
            { topNo: '4', lot: 'LOT3', cekme: 'UD E35 B35', metraj: 63 },
            { topNo: '8', lot: 'LOT3', cekme: 'UD E35 B35', metraj: 44 },
            { topNo: '12', lot: 'LOT2', cekme: 'UD E35 B35', metraj: 115 },
            { topNo: '13', lot: 'LOT2', cekme: 'UD E35 B35', metraj: 111 },
            { topNo: '20', lot: 'LOT1', cekme: 'UD E35 B35', metraj: 119 },
            { topNo: '22', lot: 'LOT8', cekme: 'UD E35 B35', metraj: 51 },
            { topNo: '25', lot: 'LOT2', cekme: 'UD E35 B35', metraj: 119 },
            { topNo: '27', lot: 'LOT1', cekme: 'UD E35 B35', metraj: 79 },
            { topNo: '39', lot: 'LOT5', cekme: 'UD E35 B35', metraj: 50 },
            { topNo: '2', lot: 'LOT3', cekme: 'E35 B35', metraj: 78 },
            { topNo: '5', lot: 'LOT4', cekme: 'E35 B35', metraj: 131 },
            { topNo: '11', lot: 'LOT1', cekme: 'E35 B35', metraj: 123 },
            { topNo: '14', lot: 'LOT1', cekme: 'E35 B35', metraj: 109 },
            { topNo: '15', lot: 'LOT1', cekme: 'E35 B35', metraj: 92 },
            { topNo: '16', lot: 'LOT4', cekme: 'E35 B35', metraj: 116 },
            { topNo: '18', lot: 'LOT1', cekme: 'E35 B35', metraj: 120 },
            { topNo: '44', lot: 'LOT7', cekme: 'E35 B35', metraj: 119 },
            { topNo: '45', lot: 'LOT7', cekme: 'E35 B35', metraj: 88 },
            { topNo: '9', lot: 'LOT2', cekme: 'UD E35 B55', metraj: 112 },
            { topNo: '19', lot: 'LOT1', cekme: 'UD E35 B55', metraj: 116 },
            { topNo: '23', lot: 'LOT2', cekme: 'UD E35 B55', metraj: 119 },
            { topNo: '24', lot: 'LOT2', cekme: 'UD E35 B55', metraj: 60 },
            { topNo: '30', lot: 'LOT8', cekme: 'UD E35 B55', metraj: 119 },
            { topNo: '3', lot: 'LOT3', cekme: 'E35 B55', metraj: 106 },
            { topNo: '6', lot: 'LOT3', cekme: 'E35 B55', metraj: 120 },
            { topNo: '7', lot: 'LOT3', cekme: 'E35 B55', metraj: 44 },
            { topNo: '26', lot: 'LOT4', cekme: 'E35 B55', metraj: 111 },
            { topNo: '28', lot: 'LOT8', cekme: 'E35 B55', metraj: 79 },
            { topNo: '29', lot: 'LOT8', cekme: 'E35 B55', metraj: 75 }
        ]
    }
]
