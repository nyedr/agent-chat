import { motion } from "framer-motion";

export const Greeting = () => {
  return (
    <div
      key="overview"
      className="max-w-3xl px-3 md:px-5 lg:px-4 xl:px-5 mx-auto md:mt-20 size-full flex flex-col justify-center"
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.5 }}
        className="text-3xl font-semibold text-foreground"
      >
        Hello there!
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.6 }}
        className="text-2xl text-muted-foreground"
      >
        How can I help you today?
      </motion.div>
    </div>
  );
};
