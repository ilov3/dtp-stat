import React, { Component } from 'react';
import PropTypes from 'prop-types';
import L from 'leaflet';
import HeatmapOverlay from 'leaflet-heatmap';
import { getColorByParticipantTypeId, mvcHasDeadParticipants} from '../services/mvcs';

const MAP_ID = 'dtp-map';
const markerMinRadius = 3;
const markerMaxRadius = 10;

const heatmapConfig = {
    scaleRadius: true,
    radius: 0.001,
    minOpacity: 0.1,
    max_val: 1,
    gradient: {0: 'white',0.25: 'yellow', 0.5: 'orange', 1: 'red'}
};

export default class Map extends Component {
    constructor(props) {
        super(props);
        this.map = null;
        this.mvcPointsLayer = null;
        this.mapObjectsMarkersLayer = null;
        this.mapObjectsMarkers = [];
        this.markers = [];
        this.isPointsLayerShown = false;

        this.setRef = this.setRef.bind(this);
        this.handleLayerClick = this.handleLayerClick.bind(this);
        this.handleZoomEnd = this.handleZoomEnd.bind(this);
        this.updateMarkerVisibility = this.updateMarkerVisibility.bind(this);

        this.state = {
            markers: []
        };
    }

    componentDidMount() {
        this.adjustMapHeight();
        this.initLeaflet();
        this.drawLayers(this.props.mvcs);
    }

    shouldComponentUpdate() {
        return false;
    }

    componentWillReceiveProps(nextProps) {
        if (nextProps.mvcs === this.props.mvcs && nextProps.mapObjectsMarkersData === this.props.mapObjectsMarkersData) {
            return;
        }
        this.drawLayers(nextProps.mvcs, nextProps.mapObjectsMarkersData);
    }

    adjustMapHeight() {
        let $element = $(this.element);
        let $parent = $(this.element.parentElement);

        $element.height($parent.height());
    }

    drawLayers(mvcs, mapObjectsMarkersData) {
        if (this.mvcPointsLayer) {
            this.mvcPointsLayer.clearLayers();
        }
        if (this.heatmapLayer) {
            this.map.removeLayer(this.heatmapLayer);
        }
        if (mvcs.length === 0) {
            return;
        }

        // if map objects was shown before, delete them first
        if (this.mapObjectsMarkers) {
            this.mapObjectsMarkers.forEach(marker => {
                this.map.removeLayer(marker);
            });
        }

        this.createMvcPointsLayer(mvcs);
        this.createHeatmapLayer(mvcs);

        this.setLayerBasedOnZoom(mvcs);

        this.createMapObjectsMarkers(mapObjectsMarkersData || [])
    }
    createMapObjectsMarkers(mapObjectsMarkersData){
        // This method will create markers and show loaded objects on map
        mapObjectsMarkersData.forEach(marker => {
            let mapObjectMarker = L.marker([marker.latitude, marker.longitude])
                    .addTo(this.map)
                    .bindPopup(marker.name)
                    .openPopup();

            this.mapObjectsMarkers.push(mapObjectMarker)
        });
    }

    createMvcPointsLayer(mvcs) {
        this.mvcPointsLayer = new L.FeatureGroup();
        this.markers = [];
        mvcs.forEach(mvc => {
            let marker = new L.circleMarker([mvc.latitude, mvc.longitude], this.getMarkerOptions(mvc));
            this.mvcPointsLayer.addLayer(marker);
            this.markers.push(marker);
        });

        this.mvcPointsLayer.on('click', this.handleLayerClick);
    }

    createHeatmapLayer(mvcs) {
        console.log(mvcs.length);
        const heatmapLayer = new HeatmapOverlay(heatmapConfig);

        const pointValue = 1;

        const data = mvcs.map(mvc => ({
            lat: mvc.latitude,
            lng: mvc.longitude,
            value: pointValue,
        }));

        heatmapLayer.setData({
            max: 2,
            data
        });

        this.heatmapLayer = heatmapLayer;
    }

    setLayerBasedOnZoom(mvcs) {
        const zoom = this.map.getZoom();
        if (zoom < 15 && mvcs.length > 1000) {
            console.log(this.heatmapLayer);
            this.map.removeLayer(this.mvcPointsLayer);
            this.map.addLayer(this.heatmapLayer);
            this.isPointsLayerShown = false;
        } else {
            this.map.removeLayer(this.heatmapLayer);
            this.map.addLayer(this.mvcPointsLayer);
            this.isPointsLayerShown = true;
            this.updateMarkerVisibility();
        }
    }

    getMarkerOptions(mvc) {
        const color = getColorByParticipantTypeId(
            mvc.participant_type_id, 
            this.props.dictionaries.mvc_participant_types
        );
        let radius = this.calcMarkerRadius(mvc);
        let options = {
            color,
            weight: 0,
            opacity: 0.5,
            fill: true,
            fillColor: color,
            fillOpacity: 1,
            radius,
            mvc,
        };

        if (mvcHasDeadParticipants(mvc)) {
            options.color = '#000000';
            options.weight = 2;
        }

        return options;
    }


    calcMarkerRadius(mvc) {
        let radius = markerMinRadius + mvc.participants.length * 0.5;
        if (radius > markerMaxRadius) {
            radius = markerMaxRadius;
        }
        return radius;
    }

    handleZoomEnd() {
        this.setLayerBasedOnZoom(this.props.mvcs);
    }

    initLeaflet() {
        const map = L.map(MAP_ID);
        const osmUrl = 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_all/{z}/{x}/{y}{r}.png';
        const osm = new L.TileLayer(
            osmUrl, {
                attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="http://cartodb.com/attributions">CartoDB</a>'
            }
        );

        let { latitude, longitude } = this.props.defaultCoord;
        const zoom = this.getZoomByRegionLevel(this.props.regionLevel);
        map.setView(new L.LatLng(latitude, longitude), zoom);
        map.addLayer(osm);

        map.on('zoomend', this.handleZoomEnd);

        map.on('resize moveend zoomend', this.updateMarkerVisibility);

        this.map = map;

        if (this.props.onMapReady) {
            this.props.onMapReady(map);
        }
    }

    updateMarkerVisibility() {
        if (!this.isPointsLayerShown) {
            return;
        }

        const mapBounds = this.map.getBounds();
        const expandedBounds = mapBounds.pad(0.7);

        this.markers.forEach((marker) => {
            var isVisible = expandedBounds.contains(marker.getLatLng()),
                wasVisible = marker._wasVisible,
                path = marker._path,
                pathParent = marker._pathParent;

            if (!pathParent) {
                pathParent = marker._pathParent = path.parentNode;
            }

            if (isVisible != wasVisible) {
                if (isVisible) {
                    pathParent.appendChild(path);
                } else {
                    pathParent.removeChild(path);
                }

                marker._wasVisible = isVisible;
            }
        });
    }

    getZoomByRegionLevel(regionLevel) {
        if (regionLevel >= 2) {
            return 14;
        }
        return 10;
    }

    handleLayerClick(event) {
        if (event.layer && event.layer.options.mvc && this.props.onMvcSelected) {
            this.props.onMvcSelected(event.layer.options.mvc);
        }
    }

    setRef(ref) {
        this.element = ref;
    }

    render() {
        return <div id={MAP_ID} ref={this.setRef} />;
    }
}

Map.propTypes = {
    defaultCoord: PropTypes.object,
    dictionaries: PropTypes.object,
    mvcs: PropTypes.array,
    onMapReady: PropTypes.func,
    onMvcSelected: PropTypes.func,
    regionLevel: PropTypes.number,
};
