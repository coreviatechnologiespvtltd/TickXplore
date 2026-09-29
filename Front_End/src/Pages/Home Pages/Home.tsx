import HomePage from "../Homepage";
import Bus_Facility from "../../Component/Bus_Facility";
import Service_Card from "../../Component/Service_Card";
import TouristVisit from "./TouristVisit";
import HomeStats from "../../Component/HomeStats";
import WhyChoose from "../../Component/WhyChoose";
import PopularRoutes from "../../Component/PopularRoutes";
import AvailableTransports from "../../Component/AvailableTransports";
import HomeCTA from "../../Component/HomeCTA";

const Home = () => {
  return (
    <div className="animate-fade-in">
      <HomePage />
      <HomeStats />
      <AvailableTransports />
      <Bus_Facility />
      <Service_Card />
      <WhyChoose />
      <PopularRoutes />
      <TouristVisit />
      <HomeCTA />
    </div>
  );
};

export default Home;