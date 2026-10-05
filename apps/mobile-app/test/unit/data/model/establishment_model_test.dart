import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/establishment/data/model/establishment_model.dart';
import 'package:mobile_app/features/establishment/domain/entity/establishment_entity.dart';

void main() {
  group('EstablishmentModel', () {
    const tEstablishmentModel = EstablishmentModel(
      id: '123',
      name: 'Test Farm',
      type: EstablishmentType.farm,
      address: EstablishmentAddressModel(
        street: '123 Green St',
        city: 'Bangkok',
        zipCode: '10110',
      ),
      coordinates: EstablishmentCoordinatesModel(lat: 13.7, lng: 100.5),
      images: ['img1.jpg'],
      titleDeedNo: 'TD-001',
      security: 'High',
    );

    test('should be a subclass of EstablishmentEntity via toEntity', () async {
      expect(tEstablishmentModel.toEntity(), isA<EstablishmentEntity>());
    });

    group('fromJson', () {
      test('should return a valid model when the JSON is standard', () async {
        final Map<String, dynamic> jsonMap = {
          'id': '123',
          'name': 'Test Farm',
          'type': 'farm',
          'address': {
            'street': '123 Green St',
            'city': 'Bangkok',
            'zipCode': '10110',
          },
          'coordinates': {'lat': 13.7, 'lng': 100.5},
          'images': ['img1.jpg'],
          'titleDeedNo': 'TD-001',
          'security': 'High',
        };

        final result = EstablishmentModel.fromJson(jsonMap);
        expect(result, tEstablishmentModel);
      });
    });
  });
}
