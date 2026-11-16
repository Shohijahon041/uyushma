import 'package:intl/intl.dart';

/// SinoTrack ST-901M H02 protokolini emulyatsiya qiluvchi sinf.
/// Format:
/// *HQ,<10_xonali_virtual_gps_id>,V1,<HHMMSS>,A,<Lat_NMEA>,N,<Lon_NMEA>,E,<Speed_Knots>,<Course>,<DDMMYY>,FFFFFBFF#
class H02Protocol {
  /// O'nlik koordinatalarni NMEA Latitude formatiga o'tkazish (ddmm.mmmm)
  static String formatNmeaLatitude(double lat) {
    final double absLat = lat.abs();
    final int degrees = absLat.floor();
    final double minutes = (absLat - degrees) * 60.0;
    final String degStr = degrees.toString().padLeft(2, '0');
    final String minStr = minutes.toStringAsFixed(4).padLeft(7, '0');
    return '$degStr$minStr';
  }

  /// O'nlik koordinatalarni NMEA Longitude formatiga o'tkazish (dddmm.mmmm)
  static String formatNmeaLongitude(double lon) {
    final double absLon = lon.abs();
    final int degrees = absLon.floor();
    final double minutes = (absLon - degrees) * 60.0;
    final String degStr = degrees.toString().padLeft(3, '0');
    final String minStr = minutes.toStringAsFixed(4).padLeft(7, '0');
    return '$degStr$minStr';
  }

  /// km/soat tezlikni uzel (knots) ga aylantirish va formatlash (025.5)
  static String formatSpeedKnots(double speedKmh) {
    final double knots = (speedKmh / 1.852).clamp(0.0, 999.0);
    final String valStr = knots.toStringAsFixed(1);
    final List<String> parts = valStr.split('.');
    final String intPart = parts[0].padLeft(3, '0');
    final String decPart = parts.length > 1 ? parts[1] : '0';
    return '$intPart.$decPart';
  }

  /// Kurs (heading/course) formatlash (180.0)
  static String formatCourse(double course) {
    final double clamped = course.clamp(0.0, 360.0);
    final String valStr = clamped.toStringAsFixed(1);
    final List<String> parts = valStr.split('.');
    final String intPart = parts[0].padLeft(3, '0');
    final String decPart = parts.length > 1 ? parts[1] : '0';
    return '$intPart.$decPart';
  }

  /// To'liq H02 paketini generatsiya qilish
  static String buildPacket({
    required String virtualGpsId,
    required double latitude,
    required double longitude,
    required double speedKmh,
    required double course,
    DateTime? timestamp,
    bool isValid = true,
  }) {
    final DateTime nowUtc = (timestamp ?? DateTime.now()).toUtc();
    final String timeStr = DateFormat('HHmmss').format(nowUtc);
    final String dateStr = DateFormat('ddMMyy').format(nowUtc);

    final String latNmea = formatNmeaLatitude(latitude);
    final String latHemi = latitude >= 0 ? 'N' : 'S';

    final String lonNmea = formatNmeaLongitude(longitude);
    final String lonHemi = longitude >= 0 ? 'E' : 'W';

    final String speedKnots = formatSpeedKnots(speedKmh);
    final String courseStr = formatCourse(course);
    final String validChar = isValid ? 'A' : 'V';

    // 10 xonali GPS IMEI tekshirish (shablon: 9170XXXXXX, masalan 9170121311)
    String cleanGpsId = virtualGpsId.replaceAll(RegExp(r'\D'), '').trim();
    if (cleanGpsId.length == 10) {
      // 10 xonali to'g'ri IMEI
    } else if (cleanGpsId.length > 10) {
      cleanGpsId = cleanGpsId.substring(cleanGpsId.length - 10);
    } else {
      cleanGpsId = '9170${cleanGpsId.padLeft(6, '0').substring(0, 6)}';
    }

    // SinoTrack ST-901M standart status baytlari (ACC ON = FFFFFBFF)
    const String statusHex = 'FFFFFBFF';

    return '*HQ,$cleanGpsId,V1,$timeStr,$validChar,$latNmea,$latHemi,$lonNmea,$lonHemi,$speedKnots,$courseStr,$dateStr,$statusHex#';
  }
}

